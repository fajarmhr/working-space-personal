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
            for kind in ("anything", "keyboard"):
                with self.subTest(kind=kind), self.assertRaises(ValueError):
                    session_directory(root, kind, identifier)

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


class CaptureApiTests(TestCase):
    """Root mounts capture_api.router; requests remain protected by the shared middleware."""
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True, HTTP_HOST="127.0.0.1:8000")
        self.token = self.client.get("/api/bootstrap").json()["csrf_token"]

    def test_native_mutations_require_csrf_before_any_service_start(self):
        for path, payload in (("/start", {"hotkey": "ctrl+shift+s"}), ("/take", {}), ("/stop", {})):
            with self.subTest(path=path), patch("workspace.capture_api.capture_service.start") as capture:
                response = self.client.post("/api/capture" + path, data=json.dumps(payload), content_type="application/json")
                self.assertEqual(response.status_code, 403)
                capture.assert_not_called()

    def test_invalid_input_and_foreign_origin_cannot_launch_recording(self):
        for path, payload, expected in (("/start", {"hotkey": "invalid"}, 422),):
            with self.subTest(path=path), patch("workspace.capture_api.capture_service.start") as capture:
                response = self.client.post("/api/capture" + path, data=json.dumps(payload), content_type="application/json", HTTP_X_CSRFTOKEN=self.token)
                self.assertEqual(response.status_code, expected)
                capture.assert_not_called()
        foreign = self.client.post("/api/capture/start", data='{"hotkey":"ctrl+shift+s"}', content_type="application/json", HTTP_X_CSRFTOKEN=self.token, HTTP_ORIGIN="https://foreign.example")
        self.assertEqual(foreign.status_code, 403)

    def test_removed_input_recorder_routes_do_not_exist(self):
        for path in ("apps", "status", "sessions", f"download/{uuid4()}"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get("/api/capture/keyboard/" + path).status_code, 404)
        for path in ("start", "stop"):
            with self.subTest(path=path):
                response = self.client.post("/api/capture/keyboard/" + path, data="{}", content_type="application/json", HTTP_X_CSRFTOKEN=self.token)
                self.assertEqual(response.status_code, 404)
