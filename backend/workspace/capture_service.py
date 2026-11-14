"""Lifecycle for native helpers. Importing this module starts no recorder or hook."""
from __future__ import annotations

import atexit
import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from ninja.errors import HttpError

from workspace.capture_common import HOTKEYS, STATES, atomic_json, read_metadata, session_directory, utc_now


class CaptureService:
    kind = "captures"
    module = "workspace.capture_worker"

    def __init__(self):
        self._lock = threading.RLock()
        self._process = None
        self._session_id = None
        self._pending_capture = None
        atexit.register(self.shutdown)

    @staticmethod
    def supported():
        return sys.platform == "win32"

    def _directory(self, identifier=None):
        try:
            return session_directory(Path(settings.DATA_DIR), self.kind, identifier or self._session_id)
        except ValueError as exc:
            raise HttpError(404, "Sesi tidak ditemukan.") from exc

    def _metadata(self):
        return read_metadata(self._directory()) if self._session_id else None

    def _refresh(self):
        metadata = self._metadata()
        if self._process is not None and self._process.poll() is not None:
            if metadata and metadata.get("state") in {"starting", "active", "stopping"}:
                metadata.update(state="error", busy=False, error="Proses perekaman berhenti. Mulai sesi baru untuk melanjutkan.")
                atomic_json(self._directory() / "status.json", metadata)
            if self._process.stdin:
                try:
                    self._process.stdin.close()
                except OSError:
                    pass
            self._process = None
            self._pending_capture = None
        return metadata

    def _public(self, metadata=None):
        metadata = metadata or {}
        count = max(0, int(metadata.get("capture_count", 0)))
        identifier = metadata.get("id")
        downloadable = identifier and count > 0 and (self._directory(identifier) / "report.docx").is_file()
        return {
            "supported": self.supported(),
            "state": metadata.get("state") if metadata.get("state") in STATES else "idle",
            "session_id": identifier,
            "hotkey": metadata.get("hotkey", "ctrl+shift+s"),
            "capture_count": count,
            "last_capture_at": metadata.get("last_capture_at"),
            "error": metadata.get("error"),
            "download_url": f"/api/capture/download/{identifier}" if downloadable else None,
            "busy": bool(metadata.get("busy", False) or self._pending_capture),
        }

    def status(self):
        with self._lock:
            metadata = self._refresh()
            if self._pending_capture and metadata:
                requested_count, requested_attempt, when = self._pending_capture
                if metadata.get("capture_count", 0) != requested_count or metadata.get("last_attempt_at") != requested_attempt or time.monotonic() - when > 20:
                    self._pending_capture = None
            return self._public(metadata)

    def _initial(self, identifier, **values):
        return {
            "id": identifier, "state": "starting", "created_at": utc_now(),
            "capture_count": 0, "last_capture_at": None, "error": None,
            "busy": False, "frames": [], **values,
        }

    def _launch(self, metadata):
        directory = session_directory(Path(settings.DATA_DIR), self.kind, metadata["id"], create=True)
        atomic_json(directory / "status.json", metadata)
        environment = os.environ.copy()
        environment["RUANG_CAPTURE_DATA_DIR"] = str(Path(settings.DATA_DIR).resolve())
        command = [sys.executable, "-m", self.module, "--session-id", metadata["id"], "--parent-pid", str(os.getpid())]
        if self.kind == "captures":
            command.extend(["--hotkey", metadata["hotkey"]])
        else:
            command.extend(["--applications", ",".join(metadata["applications"])])
        self._session_id = metadata["id"]
        try:
            with (directory / "worker-error.log").open("ab") as error_log:
                self._process = subprocess.Popen(
                    command, cwd=str(settings.BASE_DIR), env=environment,
                    stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=error_log,
                    text=True, encoding="utf-8", close_fds=True,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
        except (OSError, ValueError) as exc:
            metadata.update(state="error", error="Proses lokal tidak dapat dimulai. Periksa izin Windows dan coba lagi.")
            atomic_json(directory / "status.json", metadata)
            raise HttpError(503, metadata["error"]) from exc
        self._session_id = metadata["id"]
        self._pending_capture = None
        # Do not block a web request on registration; the UI polls starting -> active/error.
        return self._public(metadata)

    def start(self, hotkey="ctrl+shift+s"):
        with self._lock:
            if not self.supported():
                raise HttpError(422, "Fitur screenshot global tersedia pada Windows.")
            self._refresh()
            if self._process is not None:
                raise HttpError(409, "Sesi screenshot masih berjalan. Hentikan sesi itu terlebih dahulu.")
            if hotkey not in HOTKEYS:
                raise HttpError(422, "Shortcut tidak didukung.")
            return self._launch(self._initial(str(uuid4()), hotkey=hotkey))

    def _send(self, command):
        if self._process is None or self._process.stdin is None:
            raise HttpError(409, "Tidak ada sesi aktif.")
        try:
            self._process.stdin.write(command + "\n")
            self._process.stdin.flush()
        except (OSError, ValueError) as exc:
            self._refresh()
            raise HttpError(409, "Proses sesi sudah berhenti.") from exc

    def take(self):
        with self._lock:
            metadata = self._refresh()
            if not metadata or metadata.get("state") != "active" or self._process is None:
                raise HttpError(409, "Mulai sesi screenshot terlebih dahulu.")
            self.status()
            if metadata.get("busy") or self._pending_capture:
                raise HttpError(409, "Screenshot sedang diproses. Tunggu hingga selesai.")
            self._send("take")
            self._pending_capture = (metadata.get("capture_count", 0), metadata.get("last_attempt_at"), time.monotonic())
            return self._public(metadata)

    def stop(self):
        with self._lock:
            metadata = self._refresh()
            process = self._process
            if process is None:
                return self._public(metadata)
            try:
                self._send("stop")
                if process.stdin:
                    process.stdin.close()
                process.wait(timeout=8)
            except (subprocess.TimeoutExpired, HttpError, OSError):
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=3)
            metadata = self._metadata() or metadata or {}
            if metadata.get("state") in {"starting", "active", "stopping"}:
                metadata.update(state="stopped", busy=False)
                atomic_json(self._directory() / "status.json", metadata)
            self._process = None
            self._pending_capture = None
            return self._public(metadata)

    def shutdown(self):
        try:
            if self._process is not None:
                self.stop()
        except Exception:
            # The child also independently watches the parent's process handle.
            pass

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
                    items.append({"id": directory.name, "created_at": metadata.get("created_at"), **{key: public[key] for key in ("capture_count", "state", "download_url")}})
        return {"items": sorted(items, key=lambda item: item.get("created_at") or "", reverse=True)[:100]}

    def download_path(self, identifier):
        directory = self._directory(identifier)
        metadata = read_metadata(directory)
        path = directory / ("report.docx" if self.kind == "captures" else "input.txt")
        if not metadata or metadata.get("id") != directory.name or not path.is_file() or not path.resolve().is_relative_to(Path(settings.DATA_DIR).resolve()):
            raise HttpError(404, "Hasil sesi belum tersedia.")
        return path


capture_service = CaptureService()
