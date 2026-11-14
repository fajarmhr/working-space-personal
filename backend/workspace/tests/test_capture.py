"""Native capture tests use generated images and mocked processes, never screen/key hooks."""
import io
import json
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch
from uuid import uuid4

from django.test import Client, SimpleTestCase, TestCase, override_settings
from ninja.errors import HttpError

from workspace.capture_common import atomic_json, read_metadata, session_directory, session_id
from workspace.capture_document import write_capture_document
from workspace.capture_input import InputBuffer, normalized_applications
from workspace.capture_keyboard import KeyboardService
from workspace.capture_service import CaptureService


class CaptureFilesystemTests(SimpleTestCase):
    def test_opaque_ids_and_session_paths_cannot_escape_data_directory(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            identifier = str(uuid4())
            directory = session_directory(root, "captures", identifier, create=True)
            self.assertTrue(directory.is_relative_to(root))
            for value in ("../outside", "/absolute", "x", "..\\outside", "{" + identifier + "}"):
                with self.subTest(value=value), self.assertRaises(ValueError):
                    session_id(value)
            with self.assertRaises(ValueError):
                session_directory(root, "anything", identifier)

    def test_atomic_metadata_preserves_previous_file_if_replace_fails(self):
        with TemporaryDirectory() as temporary:
            path = Path(temporary) / "status.json"
            atomic_json(path, {"capture_count": 1})
            with patch("workspace.capture_common.os.replace", side_effect=PermissionError):
                with self.assertRaises(PermissionError):
                    atomic_json(path, {"capture_count": 2})
            self.assertEqual(json.loads(path.read_text()), {"capture_count": 1})
            self.assertEqual(list(path.parent.glob("*.tmp")), [])

    def test_document_fits_landscape_and_portrait_images_without_distortion(self):
        from docx import Document
        from PIL import Image
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            frames = []
            for index, size in enumerate(((1920, 1080), (700, 1500))):
                path = root / f"frame-{index}.png"
                with Image.new("RGB", size, "#dfece5") as image:
                    image.save(path)
                frames.append((path, f"2026-11-15 09:0{index}:00 WITA"))
            output = root / "report.docx"
            write_capture_document(frames, output)
            document = Document(output)
            section = document.sections[0]
            self.assertGreater(section.page_width, section.page_height)
            self.assertEqual(len(document.inline_shapes), 2)
            for shape, size in zip(document.inline_shapes, ((1920, 1080), (700, 1500))):
                self.assertLessEqual(shape.width, section.page_width - section.left_margin - section.right_margin)
                self.assertLess(shape.height, section.page_height - section.top_margin - section.bottom_margin)
                self.assertAlmostEqual(shape.width / shape.height, size[0] / size[1], places=5)
            self.assertIn("Screenshot 2 | 2026-11-15 09:01:00 WITA", "\n".join(p.text for p in document.paragraphs))
            previous = output.read_bytes()
            with self.assertRaises(FileNotFoundError):
                write_capture_document([(root / "missing.png", "now")], output)
            self.assertEqual(output.read_bytes(), previous)


class CaptureServiceTests(SimpleTestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.override = override_settings(DATA_DIR=Path(self.temporary.name))
        self.override.enable()
        self.addCleanup(self.override.disable)
        self.service = CaptureService()
        self.addCleanup(self.service.shutdown)

    def process(self):
        process = Mock()
        process.poll.return_value = None
        process.stdin = io.StringIO()
        process.wait.return_value = 0
        return process

    def test_import_and_status_do_not_start_a_native_process(self):
        with patch("workspace.capture_service.subprocess.Popen") as launch:
            fresh = CaptureService()
            self.assertEqual(fresh.status()["state"], "idle")
            launch.assert_not_called()

    def test_start_is_explicit_single_session_and_uses_fixed_hidden_worker(self):
        process = self.process()
        with patch.object(self.service, "supported", return_value=True), patch("workspace.capture_service.subprocess.Popen", return_value=process) as launch:
            status = self.service.start("ctrl+alt+s")
            self.assertEqual(status["state"], "starting")
            self.assertEqual(status["hotkey"], "ctrl+alt+s")
            args, kwargs = launch.call_args
            self.assertEqual(args[0][1:3], ["-m", "workspace.capture_worker"])
            self.assertFalse(kwargs.get("shell", False))
            self.assertEqual(kwargs["stdout"], subprocess.DEVNULL)
            with self.assertRaises(HttpError) as conflict:
                self.service.start()
            self.assertEqual(conflict.exception.status_code, 409)
            self.service.stop()
            self.assertEqual(self.service.status()["state"], "stopped")

    def test_capture_requests_are_coalesced_until_completion(self):
        process = self.process()
        with patch.object(self.service, "supported", return_value=True), patch("workspace.capture_service.subprocess.Popen", return_value=process):
            self.service.start()
            directory = self.service._directory()
            metadata = read_metadata(directory)
            metadata["state"] = "active"
            atomic_json(directory / "status.json", metadata)
            self.assertTrue(self.service.take()["busy"])
            self.assertEqual(process.stdin.getvalue(), "take\n")
            with self.assertRaises(HttpError) as busy:
                self.service.take()
            self.assertEqual(busy.exception.status_code, 409)
            metadata["capture_count"] = 1
            atomic_json(directory / "status.json", metadata)
            self.assertFalse(self.service.status()["busy"])
            self.service.stop()

    def test_dead_process_is_reported_and_download_uses_opaque_existing_session(self):
        identifier = str(uuid4())
        directory = session_directory(Path(self.temporary.name), "captures", identifier, create=True)
        atomic_json(directory / "status.json", {"id": identifier, "state": "active", "capture_count": 1})
        (directory / "report.docx").write_bytes(b"a valid saved report placeholder")
        self.service._session_id = identifier
        self.service._process = self.process()
        self.service._process.poll.return_value = 1
        self.assertEqual(self.service.status()["state"], "error")
        self.assertEqual(self.service.download_path(identifier), directory / "report.docx")
        with self.assertRaises(HttpError):
            self.service.download_path("../../secrets")
        self.assertEqual(self.service.sessions()["items"][0]["id"], identifier)

    def test_unsupported_platform_and_unknown_hotkeys_never_launch(self):
        with patch.object(self.service, "supported", return_value=False), patch("workspace.capture_service.subprocess.Popen") as launch:
            with self.assertRaises(HttpError):
                self.service.start()
            launch.assert_not_called()
        with patch.object(self.service, "supported", return_value=True), patch("workspace.capture_service.subprocess.Popen") as launch:
            with self.assertRaises(HttpError):
                self.service.start("execute-something")
            launch.assert_not_called()


class InputScopeTests(SimpleTestCase):
    def test_applications_are_allowlisted_and_deduplicated(self):
        self.assertEqual(normalized_applications(["Code.exe", "code.exe", "notepad.exe"]), ["code.exe", "notepad.exe"])
        for names in ([], ["chrome.exe"], ["..\\notepad.exe"], ["password-manager.exe"]):
            with self.assertRaises(ValueError):
                normalized_applications(names)

    def test_other_applications_and_protected_boundaries_never_join_input(self):
        lines = []
        buffer = InputBuffer(["notepad.exe", "code.exe"], lambda *line: lines.append(line))
        buffer.consume("notepad.exe", "text", "catatan")
        buffer.consume(None, "boundary")
        buffer.consume("chrome.exe", "text", "secret must not be recorded")
        buffer.consume("code.exe", "text", "git status")
        buffer.consume("code.exe", "enter")
        self.assertEqual([(app, text) for app, text, _ in lines], [("notepad.exe", "catatan"), ("code.exe", "git status")])
        self.assertNotIn("secret", str(lines))

    def test_backspace_shortcut_markers_and_long_lines_are_bounded(self):
        lines = []
        buffer = InputBuffer(["notepad.exe"], lambda *line: lines.append(line))
        buffer.consume("notepad.exe", "text", "hellox")
        buffer.consume("notepad.exe", "backspace")
        buffer.consume("notepad.exe", "text", " [CTRL+V]")
        buffer.consume("notepad.exe", "enter")
        self.assertEqual(lines[0][1], "hello [CTRL+V]")
        buffer.consume("notepad.exe", "text", "x" * 8192)
        self.assertEqual(len(lines[1][1]), 8192)
        self.assertEqual(buffer.text, "")

    def test_keyboard_service_requires_explicit_allowed_apps_and_no_clipboard_package(self):
        with TemporaryDirectory() as temporary, override_settings(DATA_DIR=Path(temporary)):
            service = KeyboardService()
            process = Mock()
            process.poll.return_value = None
            process.stdin = io.StringIO()
            process.wait.return_value = 0
            with patch.object(service, "supported", return_value=True), patch("workspace.capture_service.subprocess.Popen", return_value=process) as launch:
                status = service.start(["notepad.exe"])
                self.assertEqual(status["applications"], ["notepad.exe"])
                self.assertEqual(launch.call_args.args[0][1:3], ["-m", "workspace.capture_keyboard_worker"])
                self.assertIn("--applications", launch.call_args.args[0])
                service.stop()


class NativeKeyboardSafetyTests(SimpleTestCase):
    """Exercise the callback with synthetic structures and mocks, not a Windows hook."""
    def callback_runtime(self, foreground):
        import ctypes
        import threading
        from workspace.capture_keyboard_worker import NativeKeyboardRuntime

        class Event(ctypes.Structure):
            _fields_ = [("vkCode", ctypes.c_uint32), ("scanCode", ctypes.c_uint32), ("flags", ctypes.c_uint32), ("time", ctypes.c_uint32), ("dwExtraInfo", ctypes.c_size_t)]

        runtime = NativeKeyboardRuntime.__new__(NativeKeyboardRuntime)
        runtime.ctypes = ctypes
        runtime.KeyboardEvent = Event
        runtime.keyboard_state = (ctypes.c_ubyte * 256)()
        runtime.stop = threading.Event()
        runtime.allowed = frozenset({"notepad.exe"})
        runtime.last_scope = None
        runtime.hook = None
        runtime.user = Mock()
        runtime.user.CallNextHookEx.return_value = 0
        runtime._foreground = Mock(return_value=foreground)
        runtime._enqueue = Mock()
        runtime.on_error = Mock()
        runtime.request_stop = Mock()
        return runtime, Event

    def test_callback_rejects_other_apps_password_controls_injected_events_and_stopped_sessions(self):
        import ctypes
        for foreground, flags, stopped in [
            (("chrome.exe", 1, False), 0, False),
            (("notepad.exe", 1, True), 0, False),
            (("notepad.exe", 1, False), 0x10, False),
            (("notepad.exe", 1, False), 0, True),
        ]:
            with self.subTest(foreground=foreground, flags=flags, stopped=stopped):
                runtime, event_type = self.callback_runtime(foreground)
                if stopped:
                    runtime.stop.set()
                event = event_type(ord("A"), 30, flags, 0, 0)
                runtime._keyboard_event(0, 0x0100, ctypes.addressof(event))
                runtime._enqueue.assert_not_called()
                runtime.on_error.assert_not_called()

    def test_callback_only_queues_text_after_foreground_scope_verification(self):
        import ctypes
        runtime, event_type = self.callback_runtime(("notepad.exe", 1, False))
        def convert(key, scan, state, output, length, flags, layout):
            output.value = "a"
            return 1
        runtime.user.ToUnicodeEx.side_effect = convert
        event = event_type(ord("A"), 30, 0, 0, 0)
        runtime._keyboard_event(0, 0x0100, ctypes.addressof(event))
        runtime._enqueue.assert_any_call("notepad.exe", "text", "a")
        self.assertEqual(runtime._enqueue.call_args_list[0].args, (None, "boundary"))
        runtime.on_error.assert_not_called()

    def test_foreground_revalidates_executable_when_windows_reuses_a_pid(self):
        import ctypes
        from ctypes import wintypes
        from workspace.capture_keyboard_worker import NativeKeyboardRuntime

        runtime = NativeKeyboardRuntime.__new__(NativeKeyboardRuntime)
        runtime.ctypes, runtime.types = ctypes, wintypes
        runtime.allowed = frozenset({"notepad.exe"})
        runtime.user, runtime.kernel = Mock(), Mock()
        runtime.user.GetForegroundWindow.return_value = 500
        runtime.user.GetGUIThreadInfo.return_value = False
        runtime.GuiThreadInfo = wintypes.DWORD
        runtime.kernel.OpenProcess.return_value = 123
        def current_pid(window, pointer):
            pointer._obj.value = 87
            return 12
        runtime.user.GetWindowThreadProcessId.side_effect = current_pid
        paths = iter((r"C:\Windows\notepad.exe", r"C:\Apps\chrome.exe"))
        def current_executable(handle, flags, output, size):
            output.value = next(paths)
            return True
        runtime.kernel.QueryFullProcessImageNameW.side_effect = current_executable

        self.assertEqual(runtime._foreground(), ("notepad.exe", 12, False))
        self.assertEqual(runtime._foreground(), (None, 12, False))
        self.assertEqual(runtime.kernel.QueryFullProcessImageNameW.call_count, 2)
        self.assertEqual(runtime.kernel.CloseHandle.call_count, 2)
        runtime.user.GetForegroundWindow.side_effect = [500, 501]
        runtime.kernel.QueryFullProcessImageNameW.side_effect = lambda handle, flags, output, size: True
        self.assertEqual(runtime._foreground(), (None, 0, False))

    def test_callback_boundaries_keep_other_apps_and_password_input_out_of_buffer(self):
        import ctypes
        runtime, event_type = self.callback_runtime(("notepad.exe", 1, False))
        runtime.allowed = frozenset({"notepad.exe", "code.exe"})
        runtime._foreground.side_effect = [
            ("notepad.exe", 1, False),
            ("chrome.exe", 2, False),
            ("notepad.exe", 1, True),
            ("code.exe", 3, False),
            ("notepad.exe", 1, False),
        ]
        lines = []
        buffer = InputBuffer(list(runtime.allowed), lambda *line: lines.append(line))
        runtime._enqueue.side_effect = buffer.consume
        def convert(key, scan, state, output, length, flags, layout):
            output.value = chr(key).lower()
            return 1
        runtime.user.ToUnicodeEx.side_effect = convert
        for key in "ASQBC":
            event = event_type(ord(key), 30, 0, 0, 0)
            runtime._keyboard_event(0, 0x0100, ctypes.addressof(event))
        buffer.flush()
        self.assertEqual([(app, text) for app, text, _ in lines], [
            ("notepad.exe", "a"), ("code.exe", "b"), ("notepad.exe", "c"),
        ])
        self.assertNotIn("s", "".join(text for _, text, _ in lines))
        self.assertNotIn("q", "".join(text for _, text, _ in lines))
        runtime.on_error.assert_not_called()


class CaptureApiTests(TestCase):
    """Root mounts capture_api.router; requests remain protected by the shared middleware."""
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True, HTTP_HOST="127.0.0.1:8000")
        self.token = self.client.get("/api/bootstrap").json()["csrf_token"]

    def test_native_mutations_require_csrf_before_any_service_start(self):
        for path, payload in (("/start", {"hotkey": "ctrl+shift+s"}), ("/take", {}), ("/stop", {}), ("/keyboard/start", {"applications": ["notepad.exe"]}), ("/keyboard/stop", {})):
            with self.subTest(path=path), patch("workspace.capture_api.capture_service.start") as capture, patch("workspace.capture_api.keyboard_service.start") as keyboard:
                response = self.client.post("/api/capture" + path, data=json.dumps(payload), content_type="application/json")
                self.assertEqual(response.status_code, 403)
                capture.assert_not_called()
                keyboard.assert_not_called()

    def test_invalid_input_and_foreign_origin_cannot_launch_recording(self):
        for path, payload, expected in (("/start", {"hotkey": "invalid"}, 422), ("/keyboard/start", {"applications": ["chrome.exe"]}, 422), ("/keyboard/start", {"applications": []}, 422)):
            with self.subTest(path=path), patch("workspace.capture_api.capture_service.start") as capture, patch("workspace.capture_api.keyboard_service.start") as keyboard:
                response = self.client.post("/api/capture" + path, data=json.dumps(payload), content_type="application/json", HTTP_X_CSRFTOKEN=self.token)
                self.assertEqual(response.status_code, expected)
                capture.assert_not_called()
                keyboard.assert_not_called()
        foreign = self.client.post("/api/capture/start", data='{"hotkey":"ctrl+shift+s"}', content_type="application/json", HTTP_X_CSRFTOKEN=self.token, HTTP_ORIGIN="https://foreign.example")
        self.assertEqual(foreign.status_code, 403)
