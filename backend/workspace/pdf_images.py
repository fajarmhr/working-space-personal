"""Immutable page assets and bounded local PDF-image jobs."""
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
MAX_ASSET_BYTES = 128 * 1024 * 1024
MAX_OUTPUT_BYTES = 512 * 1024 * 1024
MAX_PAGE_PIXELS = 40_000_000
MAX_TOTAL_PIXELS = 1_000_000_000
MAX_SIDE = 8192
MAX_PAGES = 100
TIMEOUT_SECONDS = 300
ACTIVE_STATES = {"queued", "running"}
_lock = threading.RLock()
_processes: dict[str, subprocess.Popen] = {}
_lifetimes: dict[str, object] = {}
_registered_cleanup = False


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_name(value: str) -> str:
    name = str(value or "dokumen").replace("\\", "/").rsplit("/", 1)[-1]
    return re.sub(r"[\x00-\x1f\x7f]", "", name).strip()[:160] or "dokumen"


def valid_id(value: str) -> str:
    try:
        parsed = UUID(value)
    except (ValueError, TypeError, AttributeError) as error:
        raise HttpError(404, "Berkas atau pekerjaan gambar tidak ditemukan.") from error
    if parsed.version != 4 or str(parsed) != value:
        raise HttpError(404, "Berkas atau pekerjaan gambar tidak ditemukan.")
    return value


def storage_root() -> Path:
    data = Path(settings.DATA_DIR).resolve()
    root = (data / "outputs" / "pdf-images").resolve()
    if not root.is_relative_to(data):
        raise RuntimeError("PDF image outputs must stay in the local data directory.")
    return root


def job_directory(identifier: str, *, required: bool = True) -> Path:
    valid_id(identifier)
    root = storage_root()
    path = root / identifier
    resolved = path.resolve()
    if path.is_symlink() or not resolved.is_relative_to(root) or (required and not resolved.is_dir()):
        raise HttpError(404, "Pekerjaan gambar tidak ditemukan.")
    return resolved


def read_status(directory: Path) -> dict:
    try:
        result = json.loads((directory / "status.json").read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError) as error:
        raise HttpError(404, "Status pekerjaan gambar tidak ditemukan.") from error
    if not isinstance(result, dict) or result.get("id") != directory.name:
        raise HttpError(404, "Status pekerjaan gambar tidak valid.")
    return result


def write_status(directory: Path, changes: dict, *, initial=False) -> dict:
    result = {} if initial else read_status(directory)
    result.update(changes)
    result["updated_at"] = timestamp()
    pending = directory / f".status-{uuid4().hex}.tmp"
    try:
        pending.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
        os.replace(pending, directory / "status.json")
    finally:
        pending.unlink(missing_ok=True)
    return result


def public_asset(metadata: dict, job_id: str) -> dict:
    return {
        **{key: metadata[key] for key in ("id", "name", "width", "height", "dpi", "source_page", "size")},
        "job_id": job_id,
        "image_url": f"/api/pdf-images/assets/{job_id}/{metadata['id']}",
        "thumbnail_url": f"/api/pdf-images/thumbnail/{job_id}/{metadata['id']}",
    }


def public_status(status: dict) -> dict:
    return {
        **{key: status.get(key) for key in ("id", "kind", "state", "filename", "progress", "message", "error")},
        "pages": [public_asset(page, status["id"]) for page in status.get("pages", [])]
        if status.get("state") == "completed" and status.get("kind") == "import" else [],
        "download_url": f"/api/pdf-images/download/{status['id']}"
        if status.get("state") == "completed" and status.get("kind") == "export" else None,
    }


def fail_job(directory: Path, message: str) -> dict:
    return write_status(directory, {"state": "failed", "progress": None, "message": "Pemrosesan belum berhasil.", "error": message})


def get_job(identifier: str) -> dict:
    directory = job_directory(identifier)
    with _lock:
        status = read_status(directory)
        if status.get("state") in ACTIVE_STATES and identifier not in _processes:
            try:
                expired = datetime.fromisoformat(status["deadline_at"]).timestamp() + 10 < time.time()
            except (ValueError, TypeError, KeyError):
                expired = True
            if expired:
                status = fail_job(directory, "Pekerjaan terhenti saat server dimulai ulang. Ulangi impor atau ekspor.")
        return public_status(status)


def _stop(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=3)


def stop_workers():
    with _lock:
        running = list(_processes.items())
    for identifier, process in running:
        try:
            _stop(process)
            with _lock:
                directory = job_directory(identifier)
                if read_status(directory).get("state") in ACTIVE_STATES:
                    fail_job(directory, "Server berhenti sebelum pekerjaan selesai. Ulangi impor atau ekspor.")
        except (OSError, subprocess.SubprocessError, HttpError):
            pass
        finally:
            with _lock:
                lifetime = _lifetimes.pop(identifier, None)
                if lifetime is not None:
                    lifetime.close()


def _supervise(identifier, directory, process, log_file):
    try:
        try:
            process.wait(timeout=TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            _stop(process)
            with _lock:
                fail_job(directory, "Pemrosesan melewati batas 5 menit. Kurangi DPI atau jumlah halaman.")
            return
        with _lock:
            if read_status(directory).get("state") in ACTIVE_STATES:
                fail_job(directory, "Worker berhenti sebelum selesai. Kurangi DPI atau jumlah halaman lalu coba lagi.")
    finally:
        log_file.close()
        with _lock:
            _processes.pop(identifier, None)
            lifetime = _lifetimes.pop(identifier, None)
            if lifetime is not None:
                lifetime.close()


def _require_idle():
    root = storage_root()
    if root.is_dir():
        for directory in root.iterdir():
            if not directory.is_dir() or directory.is_symlink():
                continue
            try:
                status = get_job(directory.name)
            except HttpError:
                continue
            if status["state"] in ACTIVE_STATES:
                raise HttpError(409, "Satu pekerjaan PDF/gambar masih diproses. Tunggu sampai selesai.")


def _new_job(kind: str, filename: str, **details) -> tuple[Path, dict]:
    identifier = str(uuid4())
    root = storage_root()
    root.mkdir(parents=True, exist_ok=True)
    directory = job_directory(identifier, required=False)
    directory.mkdir(exist_ok=False)
    created = timestamp()
    status = write_status(directory, {
        "id": identifier, "kind": kind, "state": "queued", "filename": safe_name(filename),
        "created_at": created, "deadline_at": (datetime.fromisoformat(created) + timedelta(seconds=TIMEOUT_SECONDS)).isoformat(),
        "progress": 0, "message": "Menyiapkan pekerjaan gambar.", "error": None, "pages": [], **details,
    }, initial=True)
    return directory, status


def _launch(directory: Path, status: dict) -> dict:
    global _registered_cleanup
    environment = os.environ.copy()
    environment.update(RUANG_DATA_DIR=str(settings.DATA_DIR), RUANG_SECRET_KEY=settings.SECRET_KEY, PYTHONUNBUFFERED="1", OMP_NUM_THREADS="1", OPENBLAS_NUM_THREADS="1")
    if os.name == "nt":
        environment["RUANG_PDF_IMAGES_START_GATE"] = "1"
    log_file = (directory / "worker.log").open("ab", buffering=0)
    process = lifetime = None
    try:
        process = subprocess.Popen(
            [sys.executable, "-m", "workspace.pdf_images_worker", "--job", status["id"]],
            cwd=Path(settings.BASE_DIR), env=environment,
            stdin=subprocess.PIPE if os.name == "nt" else subprocess.DEVNULL,
            stdout=log_file, stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        if os.name == "nt":
            from workspace.pdf_conversion_process import WindowsWorkerJob
            lifetime = WindowsWorkerJob(process)
            process.stdin.write(b"ready\n")
            process.stdin.flush()
            process.stdin.close()
        _processes[status["id"]] = process
        if lifetime is not None:
            _lifetimes[status["id"]] = lifetime
        threading.Thread(target=_supervise, args=(status["id"], directory, process, log_file), name=f"ruang-images-{status['id'][:8]}", daemon=True).start()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        if lifetime is not None:
            lifetime.close()
        if process is not None:
            _stop(process)
            if process.stdin is not None and not process.stdin.closed:
                process.stdin.close()
        _processes.pop(status["id"], None)
        _lifetimes.pop(status["id"], None)
        log_file.close()
        return public_status(fail_job(directory, "Worker gambar belum dapat dijalankan. Periksa instalasi lokal."))
    if not _registered_cleanup:
        atexit.register(stop_workers)
        _registered_cleanup = True
    return public_status(status)


def _write_upload(upload, destination: Path, limit: int):
    if upload.size > limit:
        raise HttpError(413, f"Ukuran berkas maksimal {limit // 1024 // 1024} MB.")
    if upload.size == 0:
        raise HttpError(422, "Berkas masih kosong.")
    total = 0
    with destination.open("xb") as stream:
        for chunk in upload.chunks():
            total += len(chunk)
            if total > limit:
                raise HttpError(413, f"Ukuran berkas maksimal {limit // 1024 // 1024} MB.")
            stream.write(chunk)


def create_import(upload, dpi: int = 300) -> dict:
    if isinstance(dpi, bool) or not isinstance(dpi, int) or not 75 <= dpi <= 600:
        raise HttpError(422, "DPI harus bilangan bulat 75 sampai 600.")
    if not str(upload.name).lower().endswith(".pdf"):
        raise HttpError(422, "Pilih berkas PDF.")
    if upload.size > MAX_PDF_BYTES:
        raise HttpError(413, "Ukuran PDF maksimal 25 MB.")
    if not upload.size:
        raise HttpError(422, "PDF masih kosong.")
    with _lock:
        _require_idle()
        directory, status = _new_job("import", upload.name, dpi=dpi)
        try:
            _write_upload(upload, directory / "source.pdf", MAX_PDF_BYTES)
            with (directory / "source.pdf").open("rb") as stream:
                if b"%PDF-" not in stream.read(1024):
                    raise HttpError(422, "Berkas tidak memiliki header PDF yang valid.")
        except Exception:
            (directory / "source.pdf").unlink(missing_ok=True)
            (directory / "status.json").unlink(missing_ok=True)
            directory.rmdir()
            raise
        return _launch(directory, status)


def asset_metadata(job_id: str, asset_id: str) -> tuple[Path, dict]:
    valid_id(asset_id)
    directory = job_directory(job_id)
    status = read_status(directory)
    if status.get("kind") != "import" or status.get("state") != "completed":
        raise HttpError(404, "Gambar belum tersedia.")
    asset = next((page for page in status.get("pages", []) if page.get("id") == asset_id), None)
    if not asset:
        raise HttpError(404, "Gambar tidak ditemukan.")
    return directory, asset


def asset_path(job_id: str, asset_id: str, *, thumbnail=False) -> tuple[Path, dict]:
    directory, asset = asset_metadata(job_id, asset_id)
    path = directory / (f"{asset_id}-thumb.png" if thumbnail else f"{asset_id}.png")
    if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(directory):
        raise HttpError(404, "Berkas gambar tidak ditemukan.")
    return path, asset


def add_asset(upload, dpi: int = 300) -> dict:
    if isinstance(dpi, bool) or not isinstance(dpi, int) or not 75 <= dpi <= 600:
        raise HttpError(422, "DPI harus bilangan bulat 75 sampai 600.")
    if upload.size > MAX_ASSET_BYTES:
        raise HttpError(413, "Ukuran gambar maksimal 128 MB.")
    # Image uploads are bounded before Pillow decoding; PDF imports and batch
    # exports run in their own native-memory limited worker.
    from workspace.pdf_images_worker import normalize_image
    with _lock:
        _require_idle()
        directory, _ = _new_job("import", upload.name, dpi=dpi)
        source = directory / "upload.bin"
        try:
            _write_upload(upload, source, MAX_ASSET_BYTES)
            metadata = normalize_image(source, directory, dpi, safe_name(upload.name))
            write_status(directory, {"state": "completed", "progress": 100, "pages": [metadata], "message": "Gambar ditambahkan.", "error": None})
            return public_asset(metadata, directory.name)
        except ValueError as error:
            fail_job(directory, str(error))
            raise HttpError(422, str(error)) from error
        except HttpError:
            fail_job(directory, "Unggahan gambar tidak valid.")
            raise
        finally:
            source.unlink(missing_ok=True)


def create_export(pages: list[dict], image_format: str = "png", quality: int = 95, bundle: bool = True, webp_lossless: bool = False) -> dict:
    if not isinstance(pages, list) or not 1 <= len(pages) <= MAX_PAGES:
        raise HttpError(422, "Pilih 1 sampai 100 halaman untuk diekspor.")
    if image_format not in {"png", "jpeg", "webp", "tiff"}:
        raise HttpError(422, "Format gambar tidak didukung.")
    if isinstance(quality, bool) or not isinstance(quality, int) or not 1 <= quality <= 100:
        raise HttpError(422, "Kualitas harus 1 sampai 100.")
    if not isinstance(bundle, bool) or not isinstance(webp_lossless, bool) or (not bundle and len(pages) != 1):
        raise HttpError(422, "Unduhan gambar satuan harus berisi tepat satu halaman.")
    with _lock:
        _require_idle()
        references, pixels = [], 0
        for page in pages:
            if not isinstance(page, dict) or set(page) != {"job_id", "id"}:
                raise HttpError(422, "Referensi halaman tidak valid.")
            _, asset = asset_path(page["job_id"], page["id"])
            pixels += asset["width"] * asset["height"]
            references.append({"job_id": page["job_id"], "id": page["id"]})
        if pixels > MAX_TOTAL_PIXELS:
            raise HttpError(422, "Total gambar melebihi 1 gigapiksel. Ekspor dalam beberapa bagian.")
        extension = "jpg" if image_format == "jpeg" else "tif" if image_format == "tiff" else image_format
        filename = "gambar-pdf.zip" if bundle else f"halaman.{extension}"
        directory, status = _new_job("export", filename, references=references, format=image_format, quality=quality, bundle=bundle, webp_lossless=webp_lossless)
        return _launch(directory, status)


def completed_result(job_id: str) -> tuple[Path, str, str]:
    directory = job_directory(job_id)
    status = read_status(directory)
    if status.get("kind") != "export" or get_job(job_id)["state"] != "completed":
        raise HttpError(409, "Hasil ekspor belum tersedia.")
    output = directory / "result.bin"
    if output.is_symlink() or not output.is_file() or not output.resolve().is_relative_to(directory):
        raise HttpError(404, "Hasil ekspor tidak ditemukan.")
    content_type = "application/zip" if status["bundle"] else {"png": "image/png", "jpeg": "image/jpeg", "webp": "image/webp", "tiff": "image/tiff"}[status["format"]]
    return output, status["filename"], content_type
