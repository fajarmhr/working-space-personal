"""Explicit, application-scoped keyboard session lifecycle and pure input buffering."""
from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from django.conf import settings
from ninja.errors import HttpError

from workspace.capture_common import KEYBOARD_APPLICATIONS, STATES, read_metadata, utc_now
from workspace.capture_input import InputBuffer, normalized_applications
from workspace.capture_service import CaptureService


MAX_KEYBOARD_LOG_BYTES = 10 * 1024 * 1024


def validate_applications(applications):
    try:
        return normalized_applications(applications)
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


class KeyboardService(CaptureService):
    kind = "keyboard"
    module = "workspace.capture_keyboard_worker"

    def _public(self, metadata=None):
        metadata = metadata or {}
        count = max(0, int(metadata.get("line_count", 0)))
        identifier = metadata.get("id")
        downloadable = identifier and count > 0 and (self._directory(identifier) / "input.txt").is_file()
        return {
            "supported": self.supported(),
            "state": metadata.get("state") if metadata.get("state") in STATES else "idle",
            "session_id": identifier,
            "applications": metadata.get("applications", []),
            "line_count": count,
            "last_recorded_at": metadata.get("last_recorded_at"),
            "error": metadata.get("error"),
            "download_url": f"/api/capture/keyboard/download/{identifier}" if downloadable else None,
        }

    def start(self, applications):
        with self._lock:
            if not self.supported():
                raise HttpError(422, "Perekam sesi input tersedia pada Windows.")
            selected = validate_applications(applications)
            self._refresh()
            if self._process is not None:
                raise HttpError(409, "Sesi input masih berjalan. Hentikan sesi itu terlebih dahulu.")
            metadata = {
                "id": str(uuid4()), "state": "starting", "created_at": utc_now(),
                "applications": selected, "line_count": 0, "last_recorded_at": None,
                "error": None, "busy": False,
            }
            return self._launch(metadata)

    def sessions(self):
        root = Path(settings.DATA_DIR) / "outputs" / self.kind
        items = []
        if root.is_dir():
            for directory in root.iterdir():
                if not directory.is_dir():
                    continue
                try:
                    safe = self._directory(directory.name)
                except HttpError:
                    continue
                metadata = read_metadata(safe)
                if metadata and metadata.get("id") == directory.name:
                    public = self._public(metadata)
                    items.append({"id": directory.name, "created_at": metadata.get("created_at"), **{key: public[key] for key in ("line_count", "state", "applications", "download_url")}})
        return {"items": sorted(items, key=lambda item: item.get("created_at") or "", reverse=True)[:100]}


def running_application_names() -> set[str]:
    """Only return allowlisted process basenames, never a complete process inventory."""
    import os
    if os.name != "nt":
        return set()
    import ctypes
    from ctypes import wintypes

    class ProcessEntry(ctypes.Structure):
        _fields_ = [
            ("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD),
            ("th32ProcessID", wintypes.DWORD), ("th32DefaultHeapID", ctypes.c_size_t),
            ("th32ModuleID", wintypes.DWORD), ("cntThreads", wintypes.DWORD),
            ("th32ParentProcessID", wintypes.DWORD), ("pcPriClassBase", wintypes.LONG),
            ("dwFlags", wintypes.DWORD), ("szExeFile", wintypes.WCHAR * 260),
        ]
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    kernel.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(ProcessEntry)]
    kernel.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(ProcessEntry)]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.CreateToolhelp32Snapshot(0x2, 0)
    if not handle or handle == ctypes.c_void_p(-1).value:
        return set()
    names = set()
    try:
        item = ProcessEntry()
        item.dwSize = ctypes.sizeof(item)
        available = kernel.Process32FirstW(handle, ctypes.byref(item))
        while available:
            name = item.szExeFile.lower()
            if name in KEYBOARD_APPLICATIONS:
                names.add(name)
            available = kernel.Process32NextW(handle, ctypes.byref(item))
    finally:
        kernel.CloseHandle(handle)
    return names


def applications():
    running = running_application_names()
    return {"items": [{"name": name, "label": label, "running": name in running} for name, label in KEYBOARD_APPLICATIONS.items()]}


keyboard_service = KeyboardService()
