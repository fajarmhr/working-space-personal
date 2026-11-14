"""Visible, manually started, allowlisted keyboard sessions on Windows.

This module never reads clipboard contents and never starts a hook at import time.
Native Edit password controls are skipped. Terminal/webview passwords and IME
composition cannot be identified reliably; the UI must disclose those limitations.
"""
from __future__ import annotations

import argparse
import os
import queue
import sys
import threading
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from workspace.capture_common import atomic_json, read_metadata, run_parent_watchdog, session_directory, utc_now
from workspace.capture_input import InputBuffer, normalized_applications


MAX_KEYBOARD_LOG_BYTES = 10 * 1024 * 1024


class NativeKeyboardRuntime:
    def __init__(self, applications, event_queue, stop, on_error):
        import ctypes
        from ctypes import wintypes

        self.ctypes, self.types = ctypes, wintypes
        self.user = ctypes.WinDLL("user32", use_last_error=True)
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.gdi = ctypes.WinDLL("gdi32", use_last_error=True)
        self.allowed = frozenset(applications)
        self.queue, self.stop, self.on_error = event_queue, stop, on_error
        self.last_scope = None
        self.window = None
        self.hook = None
        self.registered = False
        self.keyboard_state = (ctypes.c_ubyte * 256)()
        self.user.GetKeyboardState(self.keyboard_state)
        self.kernel.GetCurrentThreadId.restype = wintypes.DWORD
        self.thread_id = self.kernel.GetCurrentThreadId()
        self.class_name = f"RuangInputSession{os.getpid()}"
        self.LRESULT = ctypes.c_ssize_t
        self.WNDPROC = ctypes.WINFUNCTYPE(self.LRESULT, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
        self.HOOKPROC = ctypes.WINFUNCTYPE(self.LRESULT, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM)

        class KeyboardEvent(ctypes.Structure):
            _fields_ = [("vkCode", wintypes.DWORD), ("scanCode", wintypes.DWORD), ("flags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ctypes.c_size_t)]

        class WindowClass(ctypes.Structure):
            _fields_ = [("style", wintypes.UINT), ("lpfnWndProc", self.WNDPROC), ("cbClsExtra", ctypes.c_int), ("cbWndExtra", ctypes.c_int), ("hInstance", wintypes.HINSTANCE), ("hIcon", wintypes.HICON), ("hCursor", wintypes.HANDLE), ("hbrBackground", wintypes.HBRUSH), ("lpszMenuName", wintypes.LPCWSTR), ("lpszClassName", wintypes.LPCWSTR)]

        class GuiThreadInfo(ctypes.Structure):
            _fields_ = [("cbSize", wintypes.DWORD), ("flags", wintypes.DWORD), ("hwndActive", wintypes.HWND), ("hwndFocus", wintypes.HWND), ("hwndCapture", wintypes.HWND), ("hwndMenuOwner", wintypes.HWND), ("hwndMoveSize", wintypes.HWND), ("hwndCaret", wintypes.HWND), ("rcCaret", wintypes.RECT)]

        self.KeyboardEvent, self.WindowClass, self.GuiThreadInfo = KeyboardEvent, WindowClass, GuiThreadInfo
        self._signatures()
        # Callback references must outlive the corresponding native registrations.
        self.window_callback = self.WNDPROC(self._window_message)
        self.hook_callback = self.HOOKPROC(self._keyboard_event)

    def _signatures(self):
        c, w, u, k = self.ctypes, self.types, self.user, self.kernel
        k.GetModuleHandleW.argtypes = [w.LPCWSTR]; k.GetModuleHandleW.restype = w.HMODULE
        k.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]; k.OpenProcess.restype = w.HANDLE
        k.QueryFullProcessImageNameW.argtypes = [w.HANDLE, w.DWORD, w.LPWSTR, c.POINTER(w.DWORD)]
        k.QueryFullProcessImageNameW.restype = w.BOOL
        k.CloseHandle.argtypes = [w.HANDLE]
        u.GetForegroundWindow.restype = w.HWND
        u.GetWindowThreadProcessId.argtypes = [w.HWND, c.POINTER(w.DWORD)]; u.GetWindowThreadProcessId.restype = w.DWORD
        u.GetGUIThreadInfo.argtypes = [w.DWORD, c.POINTER(self.GuiThreadInfo)]; u.GetGUIThreadInfo.restype = w.BOOL
        u.GetClassNameW.argtypes = [w.HWND, w.LPWSTR, c.c_int]
        u.GetWindowLongW.argtypes = [w.HWND, c.c_int]; u.GetWindowLongW.restype = w.LONG
        u.GetKeyboardLayout.argtypes = [w.DWORD]; u.GetKeyboardLayout.restype = w.HANDLE
        u.ToUnicodeEx.argtypes = [w.UINT, w.UINT, c.POINTER(c.c_ubyte), w.LPWSTR, c.c_int, w.UINT, w.HANDLE]
        u.ToUnicodeEx.restype = c.c_int
        u.RegisterClassW.argtypes = [c.POINTER(self.WindowClass)]; u.RegisterClassW.restype = w.ATOM
        u.CreateWindowExW.argtypes = [w.DWORD, w.LPCWSTR, w.LPCWSTR, w.DWORD, c.c_int, c.c_int, c.c_int, c.c_int, w.HWND, w.HMENU, w.HINSTANCE, w.LPVOID]
        u.CreateWindowExW.restype = w.HWND
        u.DefWindowProcW.argtypes = [w.HWND, w.UINT, w.WPARAM, w.LPARAM]; u.DefWindowProcW.restype = self.LRESULT
        u.SendMessageW.argtypes = [w.HWND, w.UINT, w.WPARAM, w.LPARAM]; u.SendMessageW.restype = self.LRESULT
        u.LoadCursorW.argtypes = [w.HINSTANCE, c.c_void_p]; u.LoadCursorW.restype = w.HANDLE
        u.SetWindowsHookExW.argtypes = [c.c_int, self.HOOKPROC, w.HINSTANCE, w.DWORD]; u.SetWindowsHookExW.restype = w.HANDLE
        u.CallNextHookEx.argtypes = [w.HANDLE, c.c_int, w.WPARAM, w.LPARAM]; u.CallNextHookEx.restype = self.LRESULT
        u.UnhookWindowsHookEx.argtypes = [w.HANDLE]
        u.RegisterHotKey.argtypes = [w.HWND, c.c_int, w.UINT, w.UINT]; u.RegisterHotKey.restype = w.BOOL
        u.UnregisterHotKey.argtypes = [w.HWND, c.c_int]
        u.GetMessageW.argtypes = [c.POINTER(w.MSG), w.HWND, w.UINT, w.UINT]; u.GetMessageW.restype = w.BOOL
        u.PeekMessageW.argtypes = [c.POINTER(w.MSG), w.HWND, w.UINT, w.UINT, w.UINT]
        u.PostThreadMessageW.argtypes = [w.DWORD, w.UINT, w.WPARAM, w.LPARAM]
        u.TranslateMessage.argtypes = [c.POINTER(w.MSG)]
        u.DispatchMessageW.argtypes = [c.POINTER(w.MSG)]; u.DispatchMessageW.restype = self.LRESULT
        u.DestroyWindow.argtypes = [w.HWND]
        u.ShowWindow.argtypes = [w.HWND, c.c_int]
        u.UpdateWindow.argtypes = [w.HWND]
        self.gdi.GetStockObject.argtypes = [c.c_int]; self.gdi.GetStockObject.restype = w.HANDLE

    def request_stop(self):
        self.stop.set()
        self.user.PostThreadMessageW(self.thread_id, 0x0012, 0, 0)

    def _window_message(self, window, message, first, second):
        if message == 0x0010 or (message == 0x0111 and first & 0xffff == 1001):
            self.request_stop()
            return 0
        return self.user.DefWindowProcW(window, message, first, second)

    def create_indicator(self):
        c, w, u = self.ctypes, self.types, self.user
        module = self.kernel.GetModuleHandleW(None)
        window_class = self.WindowClass()
        window_class.lpfnWndProc = self.window_callback
        window_class.hInstance = module
        window_class.hCursor = u.LoadCursorW(None, c.c_void_p(32512))
        window_class.hbrBackground = 16  # COLOR_BTNFACE + 1
        window_class.lpszClassName = self.class_name
        if not u.RegisterClassW(c.byref(window_class)):
            raise RuntimeError("Indikator sesi tidak dapat dibuat; perekaman tidak dimulai.")
        self.window = u.CreateWindowExW(0x00000008 | 0x00000080, self.class_name, "Ruang - Rekam input aktif", 0x00C80000, max(20, u.GetSystemMetrics(0) - 390), 40, 370, 175, None, None, module, None)
        if not self.window:
            raise RuntimeError("Indikator sesi tidak dapat ditampilkan; perekaman tidak dimulai.")
        message = "REKAM INPUT AKTIF\nHanya aplikasi yang kamu pilih.\nDarurat: Ctrl+Alt+Shift+K"
        text = u.CreateWindowExW(0, "STATIC", message, 0x40000000 | 0x10000000, 16, 12, 330, 64, self.window, None, module, None)
        button = u.CreateWindowExW(0, "BUTTON", "Berhenti", 0x40000000 | 0x10000000 | 0x00010000, 245, 87, 95, 31, self.window, c.c_void_p(1001), module, None)
        font = self.gdi.GetStockObject(17)
        for control in (text, button):
            if not control:
                raise RuntimeError("Kontrol penghenti sesi tidak dapat dibuat.")
            u.SendMessageW(control, 0x0030, font, 1)
        u.ShowWindow(self.window, 4)  # Show without taking focus from the user's application.
        u.UpdateWindow(self.window)
        if not u.RegisterHotKey(None, 2, 0x0001 | 0x0002 | 0x0004 | 0x4000, ord("K")):
            raise RuntimeError("Shortcut darurat Ctrl+Alt+Shift+K sedang dipakai. Perekaman tidak dimulai.")
        self.registered = True
        self.hook = u.SetWindowsHookExW(13, self.hook_callback, module, 0)
        if not self.hook:
            raise RuntimeError("Windows menolak sesi input. Perekaman tidak dimulai.")

    def _foreground(self):
        c, w, u = self.ctypes, self.types, self.user
        window = u.GetForegroundWindow()
        if not window:
            return None, 0, False
        pid = w.DWORD()
        thread_id = u.GetWindowThreadProcessId(window, c.byref(pid))
        # Windows can reuse a PID immediately after process exit. Resolve the
        # current executable on every event instead of trusting a positive cache.
        name = None
        handle = self.kernel.OpenProcess(0x1000, False, pid.value)
        if handle:
            try:
                path = c.create_unicode_buffer(32768)
                size = w.DWORD(len(path))
                if self.kernel.QueryFullProcessImageNameW(handle, 0, path, c.byref(size)):
                    candidate = path.value.rsplit("\\", 1)[-1].lower()
                    if candidate in self.allowed:
                        name = candidate
            finally:
                self.kernel.CloseHandle(handle)
        if u.GetForegroundWindow() != window:
            return None, 0, False
        protected = False
        if name:
            focus = self.GuiThreadInfo()
            focus.cbSize = c.sizeof(focus)
            if u.GetGUIThreadInfo(thread_id, c.byref(focus)) and focus.hwndFocus:
                control_class = c.create_unicode_buffer(128)
                u.GetClassNameW(focus.hwndFocus, control_class, len(control_class))
                protected = "edit" in control_class.value.lower() and bool(u.GetWindowLongW(focus.hwndFocus, -16) & 0x20)
        return name, thread_id, protected

    def _enqueue(self, application, action, value=""):
        try:
            self.queue.put_nowait((application, action, value, utc_now()))
        except queue.Full:
            self.on_error("Input terlalu cepat untuk diproses. Sesi dihentikan agar hasil tidak menyesatkan.")
            self.request_stop()

    def _keyboard_event(self, code, message, address):
        try:
            if code == 0 and not self.stop.is_set():
                event = self.ctypes.cast(address, self.ctypes.POINTER(self.KeyboardEvent)).contents
                # Ignore software-injected keys, including password-manager auto-type.
                if event.flags & 0x10:
                    return self.user.CallNextHookEx(self.hook, code, message, address)
                key = int(event.vkCode)
                down = message in (0x0100, 0x0104)
                if message in (0x0100, 0x0101, 0x0104, 0x0105) and 0 <= key < 256:
                    self.keyboard_state[key] = (self.keyboard_state[key] & 1) | (0x80 if down else 0)
                    for generic, left, right in ((0x10, 0xa0, 0xa1), (0x11, 0xa2, 0xa3), (0x12, 0xa4, 0xa5)):
                        if key in (left, right):
                            self.keyboard_state[generic] = (self.keyboard_state[left] | self.keyboard_state[right]) & 0x80
                    if key == 0x14 and down:
                        self.keyboard_state[key] ^= 1
                if not down:
                    return self.user.CallNextHookEx(self.hook, code, message, address)
                ctrl = bool(self.keyboard_state[0x11] & 0x80)
                alt = bool(self.keyboard_state[0x12] & 0x80)
                shift = bool(self.keyboard_state[0x10] & 0x80)
                windows = bool((self.keyboard_state[0x5b] | self.keyboard_state[0x5c]) & 0x80)
                if ctrl and alt and shift and key == ord("K"):
                    self.request_stop()
                    return 1
                name, thread_id, protected = self._foreground()
                scope = name if name in self.allowed and not protected else None
                if scope != self.last_scope:
                    self._enqueue(None, "boundary")
                    self.last_scope = scope
                if not scope or key in {0x10, 0x11, 0x12, 0x14, 0x5b, 0x5c, 0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5}:
                    return self.user.CallNextHookEx(self.hook, code, message, address)
                special = {0x1b: "ESC", 0x25: "LEFT", 0x26: "UP", 0x27: "RIGHT", 0x28: "DOWN", 0x24: "HOME", 0x23: "END", 0x2e: "DELETE", 0x21: "PAGEUP", 0x22: "PAGEDOWN"}
                if ctrl or alt or windows:
                    modifiers = [label for enabled, label in ((ctrl, "CTRL"), (alt, "ALT"), (shift, "SHIFT"), (windows, "WIN")) if enabled]
                    label = chr(key) if 0x30 <= key <= 0x5a else special.get(key, f"VK{key:02X}")
                    # Ctrl+V is only a shortcut marker. Clipboard data is never queried.
                    self._enqueue(scope, "text", "[" + "+".join([*modifiers, label]) + "]")
                elif key == 0x0d:
                    self._enqueue(scope, "enter")
                elif key == 0x08:
                    self._enqueue(scope, "backspace")
                elif key == 0x09:
                    self._enqueue(scope, "text", "\t")
                elif key in special or 0x70 <= key <= 0x87:
                    self._enqueue(scope, "text", "[" + special.get(key, f"F{key - 0x6f}") + "]")
                else:
                    output = self.ctypes.create_unicode_buffer(16)
                    count = self.user.ToUnicodeEx(key, event.scanCode, self.keyboard_state, output, len(output), 4, self.user.GetKeyboardLayout(thread_id))
                    if count > 0:
                        text = output.value[:count]
                        if text and all(ord(character) >= 32 for character in text):
                            self._enqueue(scope, "text", text)
        except Exception:
            self.on_error("Sesi input mengalami kendala Windows dan dihentikan.")
            self.request_stop()
        return self.user.CallNextHookEx(self.hook, code, message, address)

    def pump(self):
        message = self.types.MSG()
        while not self.stop.is_set():
            code = self.user.GetMessageW(self.ctypes.byref(message), None, 0, 0)
            if code <= 0:
                break
            if message.message == 0x0312 and message.wParam == 2:
                self.request_stop()
                continue
            self.user.TranslateMessage(self.ctypes.byref(message))
            self.user.DispatchMessageW(self.ctypes.byref(message))

    def close(self):
        if self.hook:
            self.user.UnhookWindowsHookEx(self.hook)
            self.hook = None
        if self.registered:
            self.user.UnregisterHotKey(None, 2)
            self.registered = False
        if self.window:
            self.user.DestroyWindow(self.window)
            self.window = None


def run(identifier: str, parent_pid: int, applications: list[str], data_dir: Path) -> int:
    directory = session_directory(data_dir, "keyboard", identifier)
    metadata = read_metadata(directory)
    if not metadata or metadata.get("id") != identifier:
        return 2
    if os.name != "nt":
        metadata.update(state="error", error="Sesi input memerlukan Windows.")
        atomic_json(directory / "status.json", metadata)
        return 2
    normalized_applications(applications)
    stop = threading.Event()
    events = queue.Queue(maxsize=2048)
    error = []
    runtime = None
    writer = None
    metadata_lock = threading.Lock()
    log_path = directory / "input.txt"
    header = (
        "Ruang - Sesi input manual\n"
        f"Dimulai: {utc_now()}\n"
        f"Aplikasi pilihan: {', '.join(applications)}\n"
        "Clipboard tidak dibaca. Input IME dan password terminal tidak dapat dikenali dengan andal.\n\n"
    ).encode("utf-8")
    log_path.write_bytes(header)
    byte_count = len(header)

    def set_error(message):
        if not error:
            error.append(message)

    def write_line(application, text, timestamp):
        nonlocal byte_count
        local_time = datetime.fromisoformat(timestamp).astimezone(ZoneInfo("Asia/Makassar")).strftime("%Y-%m-%d %H:%M:%S WITA")
        line = f"[{local_time}] [{application}] {text}\n".encode("utf-8")
        if byte_count + len(line) > MAX_KEYBOARD_LOG_BYTES - 1024:
            raise RuntimeError("Batas log 10 MB tercapai. Mulai sesi baru untuk melanjutkan.")
        with log_path.open("ab") as output:
            output.write(line)
            output.flush()
        byte_count += len(line)
        with metadata_lock:
            metadata["line_count"] += 1
            metadata["last_recorded_at"] = utc_now()
            atomic_json(directory / "status.json", metadata)

    buffer = InputBuffer(applications, write_line)

    def write_events():
        try:
            while not stop.is_set() or not events.empty():
                try:
                    event = events.get(timeout=0.15)
                except queue.Empty:
                    continue
                buffer.consume(*event)
            buffer.flush()
        except Exception as exc:
            set_error(str(exc)[:400] if isinstance(exc, RuntimeError) else "Log input belum tersimpan. Periksa ruang disk dan izin folder.")
            if runtime:
                runtime.request_stop()
            else:
                stop.set()

    def commands():
        for command in sys.stdin:
            if command.strip() == "stop":
                break
        if runtime:
            runtime.request_stop()

    try:
        runtime = NativeKeyboardRuntime(applications, events, stop, set_error)
        runtime.create_indicator()  # A visible stop control is mandatory before hooking begins.
        with metadata_lock:
            metadata.update(state="active", error=None)
            atomic_json(directory / "status.json", metadata)
        writer = threading.Thread(target=write_events, name="selected-input-writer", daemon=True)
        writer.start()
        threading.Thread(target=commands, name="input-session-commands", daemon=True).start()
        threading.Thread(target=run_parent_watchdog, args=(parent_pid, stop, runtime.request_stop), name="input-parent-watchdog", daemon=True).start()
        runtime.pump()
    except Exception as exc:
        set_error(str(exc)[:400])
    finally:
        stop.set()
        if runtime:
            runtime.close()
        if writer:
            writer.join(timeout=5)
        with metadata_lock:
            metadata.update(state="stopped" if not error else "error", error=error[0] if error else None, busy=False)
            atomic_json(directory / "status.json", metadata)
        try:
            with log_path.open("ab") as output:
                output.write(f"\nSesi berakhir: {utc_now()}\nJumlah baris: {metadata['line_count']}\n".encode("utf-8"))
        except OSError:
            pass
    return 1 if error else 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--parent-pid", type=int, required=True)
    parser.add_argument("--applications", required=True)
    options = parser.parse_args()
    base = os.environ.get("RUANG_CAPTURE_DATA_DIR")
    if not base or options.parent_pid < 1:
        return 2
    return run(options.session_id, options.parent_pid, options.applications.split(","), Path(base).resolve())


if __name__ == "__main__":
    raise SystemExit(main())
