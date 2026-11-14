"""Small filesystem contracts shared by explicitly started native capture workers."""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4


STATES = {"idle", "starting", "active", "stopping", "stopped", "error"}
HOTKEYS = {"ctrl+shift+s": (0x0002 | 0x0004 | 0x4000, ord("S")), "ctrl+alt+s": (0x0002 | 0x0001 | 0x4000, ord("S"))}
KEYBOARD_APPLICATIONS = {
    "notepad.exe": "Notepad",
    "notepad++.exe": "Notepad++",
    "code.exe": "Visual Studio Code",
    "powershell.exe": "Windows PowerShell",
    "pwsh.exe": "PowerShell",
    "cmd.exe": "Command Prompt",
    "windowsterminal.exe": "Windows Terminal",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def session_id(value: str) -> str:
    """Normalize an opaque ID; a user-provided filename is never accepted."""
    try:
        normalized = str(UUID(str(value)))
    except (ValueError, TypeError, AttributeError) as exc:
        raise ValueError("ID sesi tidak valid.") from exc
    if normalized != str(value).lower():
        raise ValueError("ID sesi tidak valid.")
    return normalized


def session_directory(data_dir: Path, kind: str, identifier: str, *, create=False) -> Path:
    if kind not in {"captures", "keyboard"}:
        raise ValueError("Jenis sesi tidak valid.")
    root = Path(data_dir).resolve() / "outputs" / kind
    directory = root / session_id(identifier)
    # Do not follow a directory symlink to data outside the workspace.
    if not directory.resolve().is_relative_to(Path(data_dir).resolve()):
        raise ValueError("Lokasi sesi tidak valid.")
    if create:
        directory.mkdir(parents=True, exist_ok=False)
    return directory


def atomic_json(path: Path, value: dict) -> None:
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        with temporary.open("x", encoding="utf-8") as output:
            json.dump(value, output, ensure_ascii=False)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def read_metadata(directory: Path) -> dict | None:
    path = directory / "status.json"
    try:
        if path.stat().st_size > 64 * 1024:
            return None
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else None
    except (OSError, ValueError, TypeError):
        return None


def safe_error(value: object, fallback="Proses lokal belum berhasil.") -> str:
    return (str(value).strip() or fallback)[:400]


def run_parent_watchdog(parent_pid: int, stop_event, request_stop) -> None:
    """A handle tracks the original parent even if Windows later reuses its PID."""
    if os.name != "nt":
        request_stop()
        return
    import ctypes
    from ctypes import wintypes

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.WaitForSingleObject.restype = wintypes.DWORD
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    process = kernel.OpenProcess(0x00100000, False, parent_pid)
    if not process:
        request_stop()
        return
    try:
        while not stop_event.is_set():
            result = kernel.WaitForSingleObject(process, 500)
            if result != 0x00000102:  # WAIT_TIMEOUT is the only keep-running result.
                request_stop()
                return
    finally:
        kernel.CloseHandle(process)
