"""Bounded PDF conversion jobs whose files stay inside the local workspace."""
from __future__ import annotations

import atexit
import json
import os
import re
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4

from django.conf import settings
from ninja.errors import HttpError


MAX_PDF_BYTES = 25 * 1024 * 1024
MAX_PDF_PAGES = 100
CONVERSION_TIMEOUT_SECONDS = 300
MAX_ACTIVE_JOBS = 1
ACTIVE_STATES = {"queued", "running"}
_lock = threading.RLock()
_processes: dict[str, subprocess.Popen] = {}
_lifetimes: dict[str, object] = {}
_registered_cleanup = False


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def storage_root() -> Path:
    data = Path(settings.DATA_DIR).resolve()
    root = (data / "outputs" / "pdf").resolve()
    if not root.is_relative_to(data):
        raise RuntimeError("PDF output directory must stay inside the local data directory.")
    return root


def job_directory(job_id: str, *, required: bool = True) -> Path:
    try:
        identifier = UUID(job_id)
    except (ValueError, TypeError, AttributeError) as exc:
        raise HttpError(404, "Pekerjaan konversi tidak ditemukan.") from exc
    if identifier.version != 4 or str(identifier) != job_id:
        raise HttpError(404, "Pekerjaan konversi tidak ditemukan.")
    root = storage_root()
    candidate = root / job_id
    directory = candidate.resolve()
    if candidate.is_symlink() or not directory.is_relative_to(root) or (required and not directory.is_dir()):
        raise HttpError(404, "Pekerjaan konversi tidak ditemukan.")
    return directory


def read_status(directory: Path) -> dict:
    try:
        status = json.loads((directory / "status.json").read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError) as exc:
        raise HttpError(404, "Status konversi tidak tersedia.") from exc
    if not isinstance(status, dict) or status.get("id") != directory.name:
        raise HttpError(404, "Status konversi tidak tersedia.")
    return status


def write_status(directory: Path, changes: dict, *, initial: bool = False) -> dict:
    status = {} if initial else read_status(directory)
    status.update(changes)
    status["updated_at"] = timestamp()
    temporary = directory / f".status-{uuid4().hex}.tmp"
    try:
        temporary.write_text(json.dumps(status, ensure_ascii=False), encoding="utf-8")
        os.replace(temporary, directory / "status.json")
    finally:
        temporary.unlink(missing_ok=True)
    return status


def public_status(status: dict) -> dict:
    fields = (
        "id", "state", "stage", "mode", "filename", "created_at", "updated_at",
        "page_count", "progress", "message", "warnings", "error",
    )
    result = {field: status.get(field) for field in fields}
    result.update(
        ocr_mode=status.get('ocr_mode', 'off'),
        ocr_language=status.get('ocr_language', 'eng+ind'),
        ocr_pages=status.get('ocr_pages', []),
        timeout_seconds=status.get('timeout_seconds', 60),
    )
    result["download_url"] = (
        f"/api/pdf/download/{status['id']}" if status.get("state") == "completed" else None
    )
    return result


def get_job(job_id: str) -> dict:
    directory = job_directory(job_id)
    with _lock:
        status = read_status(directory)
        # A restarted server cannot control an old process safely. Wait for its
        # bounded deadline, then expose an actionable failure instead of polling forever.
        if status.get("state") in ACTIVE_STATES and job_id not in _processes:
            try:
                deadline = datetime.fromisoformat(status["deadline_at"]).timestamp()
            except (ValueError, TypeError, KeyError):
                try:
                    deadline = datetime.fromisoformat(status["created_at"]).timestamp() + CONVERSION_TIMEOUT_SECONDS
                except (ValueError, TypeError, KeyError):
                    deadline = 0
            if time.time() > deadline + 10:
                status = fail_job(directory, "Konversi terhenti saat server dimulai ulang. Unggah kembali PDF.")
        return public_status(status)


def fail_job(directory: Path, message: str) -> dict:
    return write_status(directory, {
        "state": "failed", "stage": "failed", "progress": None,
        "message": "Konversi belum berhasil.", "error": message,
    })


def _safe_filename(filename: str) -> str:
    name = str(filename or "dokumen.pdf").replace("\\", "/").rsplit("/", 1)[-1]
    name = re.sub(r"[\x00-\x1f\x7f]", "", name).strip()
    return (name or "dokumen.pdf")[:180]


def _stop_process(process: subprocess.Popen) -> None:
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=3)


def _supervise(job_id: str, directory: Path, process: subprocess.Popen, log_file) -> None:
    try:
        try:
            process.wait(timeout=CONVERSION_TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            _stop_process(process)
            with _lock:
                fail_job(directory, "Konversi melewati batas 5 menit. Coba PDF dengan halaman lebih sedikit.")
            return
        with _lock:
            status = read_status(directory)
            if status.get("state") in ACTIVE_STATES:
                fail_job(directory, "Proses konversi berhenti sebelum selesai. Coba unggah kembali PDF.")
    finally:
        log_file.close()
        with _lock:
            _processes.pop(job_id, None)
            lifetime = _lifetimes.pop(job_id, None)
            if lifetime is not None:
                lifetime.close()
            try:
                if read_status(directory).get("state") == "failed":
                    (directory / ".result-pending.docx").unlink(missing_ok=True)
                    (directory / ".ocr-normalized.pdf").unlink(missing_ok=True)
            except (OSError, HttpError):
                pass


def stop_workers() -> None:
    with _lock:
        processes = list(_processes.items())
    for job_id, process in processes:
        try:
            _stop_process(process)
            with _lock:
                directory = job_directory(job_id)
                if read_status(directory).get("state") in ACTIVE_STATES:
                    fail_job(directory, "Server dihentikan sebelum konversi selesai. Unggah kembali PDF.")
        except (OSError, subprocess.SubprocessError, HttpError):
            pass
        finally:
            with _lock:
                lifetime = _lifetimes.pop(job_id, None)
                if lifetime is not None:
                    lifetime.close()


def _active_count() -> int:
    root = storage_root()
    count = 0
    if root.is_dir():
        for path in root.iterdir():
            if not path.is_dir() or path.is_symlink():
                continue
            try:
                status = get_job(path.name)
            except HttpError:
                continue
            if status["state"] in ACTIVE_STATES:
                count += 1
    return count


def create_job(upload, mode: str = "editable", *, ocr_mode: str = 'auto', ocr_language: str = 'eng+ind') -> dict:
    global _registered_cleanup
    if mode != "editable":
        raise HttpError(422, "Mode konversi belum didukung.")
    if ocr_mode not in {'auto', 'off', 'force'} or ocr_language not in {'eng+ind', 'eng', 'ind'}:
        raise HttpError(422, "Pilihan OCR tidak valid.")
    if upload.size > MAX_PDF_BYTES:
        raise HttpError(413, "Ukuran PDF maksimal 25 MB.")
    if upload.size == 0:
        raise HttpError(422, "PDF masih kosong.")
    with _lock:
        if _active_count() >= MAX_ACTIVE_JOBS:
            raise HttpError(409, "Satu PDF masih diproses. Tunggu sampai selesai lalu coba lagi.")
        identifier = str(uuid4())
        root = storage_root()
        root.mkdir(parents=True, exist_ok=True)
        directory = job_directory(identifier, required=False)
        directory.mkdir(exist_ok=False)
        source = directory / "source.pdf"
        total = 0
        try:
            with source.open("xb") as stream:
                for chunk in upload.chunks():
                    total += len(chunk)
                    if total > MAX_PDF_BYTES:
                        raise HttpError(413, "Ukuran PDF maksimal 25 MB.")
                    stream.write(chunk)
            with source.open("rb") as stream:
                header = stream.read(1024)
            if b"%PDF-" not in header:
                raise HttpError(422, "Berkas tidak memiliki header PDF yang valid.")
            created = timestamp()
            deadline = (datetime.fromisoformat(created) + timedelta(seconds=CONVERSION_TIMEOUT_SECONDS)).isoformat()
            status = write_status(directory, {
                "id": identifier, "state": "queued", "stage": "queued", "mode": mode,
                "ocr_mode": ocr_mode, "ocr_language": ocr_language, "ocr_pages": [],
                "filename": _safe_filename(upload.name), "created_at": created,
                "deadline_at": deadline, "timeout_seconds": CONVERSION_TIMEOUT_SECONDS,
                "page_count": None, "progress": 0, "message": "Menyiapkan konversi PDF.",
                "warnings": ["Layout hasil dapat berbeda dari PDF, terutama untuk font, kolom, dan tabel kompleks."],
                "error": None,
            }, initial=True)
            environment = os.environ.copy()
            environment["RUANG_DATA_DIR"] = str(settings.DATA_DIR)
            environment["RUANG_SECRET_KEY"] = settings.SECRET_KEY
            environment["PYTHONUNBUFFERED"] = "1"
            environment["OMP_NUM_THREADS"] = "1"
            environment["OPENBLAS_NUM_THREADS"] = "1"
            if os.name == "nt":
                environment["RUANG_PDF_START_GATE"] = "1"
            log_file = (directory / "conversion.log").open("ab", buffering=0)
            process = None
            lifetime = None
            try:
                process = subprocess.Popen(
                    [sys.executable, "-m", "workspace.pdf_conversion_worker", "--job", identifier],
                    cwd=Path(settings.BASE_DIR), env=environment,
                    stdin=subprocess.PIPE if os.name == "nt" else subprocess.DEVNULL,
                    stdout=log_file, stderr=subprocess.STDOUT,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                )
                if os.name == "nt":
                    from workspace.pdf_conversion_process import WindowsWorkerJob

                    lifetime = WindowsWorkerJob(process)
                    # The worker waits for this gate before parsing the PDF. If
                    # assignment fails or the backend dies here, it cannot run.
                    process.stdin.write(b"ready\n")
                    process.stdin.flush()
                    process.stdin.close()
            except (OSError, ValueError, subprocess.SubprocessError):
                if lifetime is not None:
                    lifetime.close()
                if process is not None:
                    _stop_process(process)
                    if process.stdin is not None:
                        process.stdin.close()
                log_file.close()
                fail_job(directory, "Worker PDF belum dapat dijalankan. Periksa instalasi dependensi.")
                return public_status(read_status(directory))
            _processes[identifier] = process
            if lifetime is not None:
                _lifetimes[identifier] = lifetime
            if not _registered_cleanup:
                atexit.register(stop_workers)
                _registered_cleanup = True
            try:
                threading.Thread(
                    target=_supervise, args=(identifier, directory, process, log_file),
                    name=f"ruang-pdf-{identifier[:8]}", daemon=True,
                ).start()
            except RuntimeError:
                # Never run a converter without its wall-clock supervisor.
                if lifetime is not None:
                    lifetime.close()
                _stop_process(process)
                _processes.pop(identifier, None)
                _lifetimes.pop(identifier, None)
                log_file.close()
                return public_status(fail_job(directory, "Pemantau konversi belum dapat dimulai. Coba unggah kembali PDF."))
            return public_status(status)
        except Exception:
            # An invalid upload never becomes a job and should not retain its content.
            if not (directory / "status.json").exists():
                source.unlink(missing_ok=True)
                directory.rmdir()
            raise


def completed_result(job_id: str) -> tuple[Path, str]:
    directory = job_directory(job_id)
    status = get_job(job_id)
    if status["state"] != "completed":
        raise HttpError(409, "DOCX belum tersedia. Tunggu konversi selesai.")
    output = directory / "result.docx"
    if output.is_symlink() or not output.is_file() or not output.resolve().is_relative_to(directory):
        raise HttpError(404, "Hasil konversi tidak ditemukan.")
    filename = status["filename"]
    if filename.lower().endswith(".pdf"):
        filename = filename[:-4]
    return output, filename + ".docx"
