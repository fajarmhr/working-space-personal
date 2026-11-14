"""Opt-in screenshot worker; launched only by an explicit authenticated local POST."""
from __future__ import annotations

import argparse
import os
import sys
import threading
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from workspace.capture_common import HOTKEYS, atomic_json, read_metadata, run_parent_watchdog, session_directory, utc_now
from workspace.capture_document import MAX_CAPTURE_COUNT, MAX_CAPTURE_PIXELS, MAX_SESSION_BYTES, write_capture_document


def run(identifier: str, parent_pid: int, hotkey: str, data_dir: Path) -> int:
    directory = session_directory(data_dir, "captures", identifier)
    metadata = read_metadata(directory)
    if not metadata or metadata.get("id") != identifier:
        return 2
    if os.name != "nt":
        metadata.update(state="error", error="Screenshot global memerlukan Windows.")
        atomic_json(directory / "status.json", metadata)
        return 2
    import ctypes
    from ctypes import wintypes

    user = ctypes.WinDLL("user32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    user.RegisterHotKey.argtypes = [wintypes.HWND, ctypes.c_int, wintypes.UINT, wintypes.UINT]
    user.RegisterHotKey.restype = wintypes.BOOL
    user.UnregisterHotKey.argtypes = [wintypes.HWND, ctypes.c_int]
    user.GetMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT]
    user.GetMessageW.restype = wintypes.BOOL
    user.PeekMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT, wintypes.UINT]
    user.PostThreadMessageW.argtypes = [wintypes.DWORD, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    kernel.GetCurrentThreadId.restype = wintypes.DWORD
    thread_id = kernel.GetCurrentThreadId()
    # A thread message queue must exist before command/watchdog threads can post to it.
    message = wintypes.MSG()
    user.PeekMessageW(ctypes.byref(message), None, 0, 0, 0)
    stop = threading.Event()
    take_message = 0x8001

    def request_stop():
        stop.set()
        user.PostThreadMessageW(thread_id, 0x0012, 0, 0)

    def commands():
        for command in sys.stdin:
            if command.strip() == "take":
                user.PostThreadMessageW(thread_id, take_message, 0, 0)
            elif command.strip() == "stop":
                break
        request_stop()

    registered = False
    try:
        modifiers, key = HOTKEYS[hotkey]
        if not user.RegisterHotKey(None, 1, modifiers, key):
            raise RuntimeError("Shortcut sedang dipakai aplikasi lain. Pilih kombinasi lain lalu mulai lagi.")
        registered = True
        metadata.update(state="active", error=None, busy=False)
        atomic_json(directory / "status.json", metadata)
        threading.Thread(target=commands, name="capture-commands", daemon=True).start()
        threading.Thread(target=run_parent_watchdog, args=(parent_pid, stop, request_stop), name="capture-parent-watchdog", daemon=True).start()
        frames = []
        frame_root = directory / "frames"
        frame_root.mkdir(exist_ok=True)
        total_bytes = 0
        while not stop.is_set():
            code = user.GetMessageW(ctypes.byref(message), None, 0, 0)
            if code <= 0:
                break
            if message.message not in {0x0312, take_message}:
                continue
            if len(frames) >= MAX_CAPTURE_COUNT:
                metadata.update(error="Batas 200 screenshot tercapai. Hentikan sesi dan mulai sesi baru.")
                atomic_json(directory / "status.json", metadata)
                continue
            metadata.update(busy=True, error=None, last_attempt_at=utc_now())
            atomic_json(directory / "status.json", metadata)
            frame = frame_root / f"{len(frames) + 1:04d}.png"
            try:
                from PIL import ImageGrab
                with ImageGrab.grab(all_screens=False) as screenshot:
                    if screenshot.width * screenshot.height > MAX_CAPTURE_PIXELS:
                        raise RuntimeError("Resolusi layar melebihi batas 40 megapiksel.")
                    screenshot.save(frame, format="PNG")
                size = frame.stat().st_size
                if total_bytes + size > MAX_SESSION_BYTES:
                    raise RuntimeError("Batas ukuran sesi 256 MB tercapai. Mulai sesi baru.")
                timestamp = datetime.now(ZoneInfo("Asia/Makassar")).strftime("%Y-%m-%d %H:%M:%S WITA")
                candidate = [*frames, (frame, timestamp)]
                write_capture_document(candidate, directory / "report.docx")
                frames = candidate
                total_bytes += size
                metadata.update(capture_count=len(frames), last_capture_at=utc_now(), frames=[{"name": path.name, "timestamp": time} for path, time in frames])
                try:
                    import winsound
                    winsound.Beep(900, 80)
                except (RuntimeError, OSError):
                    pass
            except PermissionError:
                frame.unlink(missing_ok=True)
                metadata["error"] = "Dokumen sedang dipakai aplikasi lain. Tutup dokumen lalu coba lagi."
            except Exception:
                frame.unlink(missing_ok=True)
                metadata["error"] = "Screenshot belum tersimpan. Periksa izin layar dan ruang disk, lalu coba lagi."
            finally:
                metadata["busy"] = False
                atomic_json(directory / "status.json", metadata)
            # Coalesce queued repeated presses rather than building an unbounded capture backlog.
            for queued in (0x0312, take_message):
                while user.PeekMessageW(ctypes.byref(message), None, queued, queued, 1):
                    pass
    except Exception as exc:
        metadata.update(state="error", busy=False, error=str(exc)[:400])
        atomic_json(directory / "status.json", metadata)
        return 1
    finally:
        stop.set()
        if registered:
            user.UnregisterHotKey(None, 1)
        if metadata.get("state") != "error":
            metadata.update(state="stopped", busy=False)
            atomic_json(directory / "status.json", metadata)
    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--parent-pid", type=int, required=True)
    parser.add_argument("--hotkey", choices=tuple(HOTKEYS), required=True)
    options = parser.parse_args()
    base = os.environ.get("RUANG_CAPTURE_DATA_DIR")
    if not base or options.parent_pid < 1:
        return 2
    return run(options.session_id, options.parent_pid, options.hotkey, Path(base).resolve())


if __name__ == "__main__":
    raise SystemExit(main())
