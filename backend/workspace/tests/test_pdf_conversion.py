import io
import ctypes
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch
from unittest import skipUnless
from uuid import uuid4
from zipfile import ZipFile

import pymupdf
from docx import Document
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from ninja.errors import HttpError

from workspace import pdf_conversion as service
from workspace.pdf_conversion_worker import PdfConversionError, inspect_pdf, run_job, verify_docx


def sample_pdf() -> bytes:
    """A real two-column/table/image fixture, with text that must remain editable."""
    with pymupdf.open() as document:
        page = document.new_page(width=595, height=842)
        page.insert_text((45, 55), "Laporan Proyek Ruang", fontsize=20)
        page.insert_textbox(pymupdf.Rect(45, 90, 280, 245),
                            "Kolom kiri\nRencana pekerjaan dan hasil pemeriksaan.\nData harus tetap dapat diedit di Word.", fontsize=11)
        page.insert_textbox(pymupdf.Rect(315, 90, 550, 245),
                            "Kolom kanan\nCatatan tindak lanjut dan jadwal.\nTabel berikut merangkum pekerjaan.", fontsize=11)
        for y in (300, 335, 370, 405):
            page.draw_line((45, y), (550, y), width=0.8)
        for x in (45, 310, 430, 550):
            page.draw_line((x, 300), (x, 405), width=0.8)
        for y, values in [(322, ("Pekerjaan", "Status", "Jumlah")),
                          (357, ("Dokumentasi", "Selesai", "7")),
                          (392, ("Pemeriksaan", "Berjalan", "12"))]:
            for x, value in zip((55, 320, 440), values):
                page.insert_text((x, y), value, fontsize=11)
        picture = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 120, 60), 0)
        picture.clear_with(180)
        page.insert_image(pymupdf.Rect(45, 455, 225, 545), pixmap=picture)
        second = document.new_page(width=595, height=842)
        second.insert_text((45, 55), "Halaman Kedua", fontsize=18)
        second.insert_text((45, 95), "Kesimpulan pemeriksaan tetap berupa teks editable.", fontsize=11)
        return document.tobytes()


class PdfConversionTests(TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory(prefix="ruang-pdf-tests-")
        self.settings_override = override_settings(DATA_DIR=Path(self.temporary.name))
        self.settings_override.enable()
        self.client = Client(enforce_csrf_checks=True, HTTP_HOST="127.0.0.1:8000")
        self.token = self.client.get("/api/bootstrap").json()["csrf_token"]

    def tearDown(self):
        service.stop_workers()
        service._processes.clear()
        self.settings_override.disable()
        self.temporary.cleanup()

    def metadata(self, job_id=None, **changes):
        identifier = job_id or str(uuid4())
        directory = service.job_directory(identifier, required=False)
        directory.mkdir(parents=True)
        data = {
            "id": identifier, "state": "queued", "stage": "queued", "mode": "editable",
            "filename": "dokumen.pdf", "created_at": service.timestamp(),
            "page_count": None, "progress": 0, "message": "Menyiapkan konversi.",
            "warnings": [], "error": None, **changes,
        }
        service.write_status(directory, data, initial=True)
        return identifier, directory

    def upload(self, content, name="contoh.pdf"):
        return SimpleUploadedFile(name, content, content_type="application/pdf")

    def post(self, file, **extra):
        return self.client.post("/api/pdf/convert", {"file": file, "mode": "editable", **extra},
                                HTTP_X_CSRFTOKEN=self.token)

    def test_upload_requires_csrf_and_unknown_mode_is_rejected(self):
        unauthenticated = Client(enforce_csrf_checks=True, HTTP_HOST="127.0.0.1:8000")
        result = unauthenticated.post("/api/pdf/convert", {"file": self.upload(b"%PDF-1.7")})
        self.assertEqual(result.status_code, 403)
        result = self.client.post("/api/pdf/convert", {"file": self.upload(b"%PDF-1.7"), "mode": "visual"},
                                  HTTP_X_CSRFTOKEN=self.token)
        self.assertEqual(result.status_code, 422)

    def test_invalid_empty_and_oversized_uploads_do_not_start_workers(self):
        with patch.object(service.subprocess, "Popen") as process:
            self.assertEqual(self.post(self.upload(b"not a PDF")).status_code, 422)
            self.assertEqual(self.post(self.upload(b"")).status_code, 422)
            with patch.object(service, "MAX_PDF_BYTES", 8):
                self.assertEqual(self.post(self.upload(b"%PDF-1.7 content")).status_code, 413)
            process.assert_not_called()
        self.assertFalse(any(service.storage_root().glob("*/source.pdf")))

    def test_worker_launch_failure_is_a_persisted_actionable_job(self):
        with patch.object(service.subprocess, "Popen", side_effect=OSError("unavailable")):
            result = self.post(self.upload(b"%PDF-1.7 minimal", "../../contoh.pdf"))
        self.assertEqual(result.status_code, 202)
        job = result.json()
        self.assertEqual(job["filename"], "contoh.pdf")
        self.assertEqual(job["state"], "failed")
        self.assertIsNone(job["download_url"])
        self.assertIn("Worker PDF", job["error"])
        self.assertEqual(self.client.get(f"/api/pdf/jobs/{job['id']}").json()["state"], "failed")

    def test_opaque_ids_download_state_and_path_traversal_are_checked(self):
        for value in ("..", "../../secret", "not-a-uuid", str(uuid4()).upper()):
            with self.subTest(value=value), self.assertRaises(HttpError):
                service.job_directory(value)
        identifier, _ = self.metadata()
        self.assertEqual(self.client.get(f"/api/pdf/download/{identifier}").status_code, 409)
        self.assertEqual(self.client.get(f"/api/pdf/jobs/{uuid4()}").status_code, 404)

    def test_one_active_job_is_enforced_and_expired_orphans_fail(self):
        identifier, directory = self.metadata()
        with patch.object(service.subprocess, "Popen") as process:
            self.assertEqual(self.post(self.upload(b"%PDF-1.7 content")).status_code, 409)
            process.assert_not_called()
        service.write_status(directory, {
            "created_at": (datetime.now(timezone.utc) - timedelta(seconds=90)).isoformat(),
            "deadline_at": (datetime.now(timezone.utc) - timedelta(seconds=30)).isoformat(),
        })
        self.assertEqual(service.get_job(identifier)["state"], "failed")
        self.assertIn("server", service.get_job(identifier)["error"])

    def test_inspection_rejects_scans_corrupt_encrypted_and_excess_pages(self):
        path = Path(self.temporary.name) / "inspect.pdf"
        with pymupdf.open() as document:
            document.new_page().draw_rect(pymupdf.Rect(20, 20, 100, 100), fill=(0.5, 0.5, 0.5))
            document.save(path)
        with self.assertRaisesRegex(PdfConversionError, "OCR"):
            inspect_pdf(path)
        path.write_bytes(b"%PDF-1.7 invalid")
        with self.assertRaisesRegex(PdfConversionError, "rusak"):
            inspect_pdf(path)
        with pymupdf.open() as document:
            document.new_page().insert_text((40, 40), "Secret example")
            document.save(path, encryption=pymupdf.PDF_ENCRYPT_AES_256,
                          owner_pw="fixture-owner", user_pw="fixture-user")
        with self.assertRaisesRegex(PdfConversionError, "sandi"):
            inspect_pdf(path)
        with pymupdf.open() as document:
            for _ in range(101):
                document.new_page()
            document.save(path)
        with self.assertRaisesRegex(PdfConversionError, "100 halaman"):
            inspect_pdf(path)

    def test_mixed_scan_pages_warn_and_metadata_stage_is_real(self):
        identifier, directory = self.metadata()
        path = directory / "source.pdf"
        with pymupdf.open() as document:
            document.new_page().insert_text((40, 40), "Editable paragraph")
            document.new_page().draw_rect(pymupdf.Rect(20, 20, 100, 100))
            document.save(path)
        count, warnings = inspect_pdf(path)
        self.assertEqual(count, 2)
        self.assertTrue(any("Halaman 2" in warning for warning in warnings))
        with patch("workspace.pdf_conversion_worker.convert_editable", side_effect=RuntimeError("internal failure")):
            run_job(identifier)
        job = service.get_job(identifier)
        self.assertEqual(job["state"], "failed")
        self.assertEqual(job["stage"], "failed")
        self.assertNotIn("internal failure", job["error"])
        self.assertFalse((directory / ".result-pending.docx").exists())

    def test_timeout_stops_only_its_own_process_and_removes_partial_docx(self):
        identifier, directory = self.metadata()
        (directory / ".result-pending.docx").write_bytes(b"partial")
        process = Mock()
        process.poll.return_value = None
        process.wait.side_effect = [subprocess.TimeoutExpired("fixture", 60), 0]
        service._processes[identifier] = process
        log = io.BytesIO()
        service._supervise(identifier, directory, process, log)
        process.terminate.assert_called_once()
        self.assertTrue(log.closed)
        self.assertNotIn(identifier, service._processes)
        self.assertEqual(service.get_job(identifier)["state"], "failed")
        self.assertIn("60 detik", service.get_job(identifier)["error"])
        self.assertFalse((directory / ".result-pending.docx").exists())

    def test_shutdown_stops_workers_and_persists_failure(self):
        identifier, directory = self.metadata()
        process = Mock()
        process.poll.return_value = None
        service._processes[identifier] = process
        lifetime = Mock()
        service._lifetimes[identifier] = lifetime
        service.stop_workers()
        process.terminate.assert_called_once()
        lifetime.close.assert_called_once()
        self.assertNotIn(identifier, service._lifetimes)
        self.assertEqual(service.get_job(identifier)["state"], "failed")
        self.assertIn("Server dihentikan", service.get_job(identifier)["error"])

    def test_worker_is_stopped_if_its_supervisor_cannot_start(self):
        with patch.object(service.threading.Thread, "start", side_effect=RuntimeError("no thread")):
            result = self.post(self.upload(sample_pdf()))
        self.assertEqual(result.status_code, 202)
        job = result.json()
        self.assertEqual(job["state"], "failed")
        self.assertIn("Pemantau", job["error"])
        self.assertNotIn(job["id"], service._processes)
        self.assertNotIn(job["id"], service._lifetimes)

    @skipUnless(os.name == "nt", "Windows kernel lifetime guard")
    def test_abrupt_backend_exit_kills_its_worker_without_an_atexit_hook(self):
        from ctypes import wintypes

        helper = """
import os, subprocess, sys
from workspace.pdf_conversion_process import WindowsWorkerJob
worker = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'],
                          stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                          creationflags=subprocess.CREATE_NO_WINDOW)
guard = WindowsWorkerJob(worker)
print(worker.pid, flush=True)
sys.stdin.readline()
os._exit(0)
"""
        backend = subprocess.Popen(
            [sys.executable, "-c", helper], cwd=Path(__file__).parents[2],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.WaitForSingleObject.restype = wintypes.DWORD
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel.CloseHandle.restype = wintypes.BOOL
        worker_handle = None
        try:
            worker_pid = int(backend.stdout.readline())
            worker_handle = kernel.OpenProcess(0x00100000, False, worker_pid)  # SYNCHRONIZE only
            self.assertTrue(worker_handle)
            self.assertEqual(kernel.WaitForSingleObject(worker_handle, 0), 258)  # WAIT_TIMEOUT: alive
            backend.stdin.write(b"exit\n")
            backend.stdin.flush()
            backend.wait(timeout=5)
            self.assertEqual(kernel.WaitForSingleObject(worker_handle, 5000), 0)
        finally:
            if backend.poll() is None:
                backend.kill()
                backend.wait(timeout=5)
            for stream in (backend.stdin, backend.stdout, backend.stderr):
                stream.close()
            if worker_handle:
                kernel.CloseHandle(worker_handle)

    def test_output_verification_rejects_blank_tables_and_non_docx_files(self):
        output = Path(self.temporary.name) / "output.docx"
        document = Document()
        document.add_table(rows=1, cols=2)
        document.save(output)
        with self.assertRaisesRegex(PdfConversionError, "editable"):
            verify_docx(output)
        output.write_bytes(b"not a DOCX")
        with self.assertRaisesRegex(PdfConversionError, "diverifikasi"):
            verify_docx(output)

    def test_real_conversion_keeps_text_table_image_and_produces_valid_docx(self):
        identifier, directory = self.metadata(filename="Laporan.pdf")
        (directory / "source.pdf").write_bytes(sample_pdf())
        run_job(identifier)
        status = service.get_job(identifier)
        log = (service.job_directory(identifier) / "conversion.log")
        details = log.read_text(encoding="utf-8", errors="replace") if log.exists() else ""
        self.assertEqual(status["state"], "completed", f"{status}\n{details}")
        self.assertEqual(status["page_count"], 2)
        self.assertEqual(status["progress"], 100)
        path, filename = service.completed_result(identifier)
        self.assertEqual(filename, "Laporan.docx")
        verify_docx(path)
        document = Document(path)
        text = " ".join(document.element.body.itertext())
        for value in ("Laporan Proyek Ruang", "Kolom kiri", "Kolom kanan", "Dokumentasi", "Halaman Kedua"):
            self.assertIn(value, text)
        self.assertGreaterEqual(len(document.tables), 1)
        with ZipFile(path) as archive:
            self.assertTrue(any(name.startswith("word/media/") for name in archive.namelist()))
        downloaded = self.client.get(f"/api/pdf/download/{identifier}")
        self.assertEqual(downloaded.status_code, 200)
        self.assertIn("Laporan.docx", downloaded["Content-Disposition"])
        downloaded.close()

    def test_separate_worker_job_reaches_a_terminal_state(self):
        result = self.post(self.upload(sample_pdf(), "Subprocess.pdf"))
        self.assertEqual(result.status_code, 202)
        identifier = result.json()["id"]
        deadline = time.monotonic() + 35
        while time.monotonic() < deadline:
            status = service.get_job(identifier)
            if status["state"] not in service.ACTIVE_STATES:
                break
            time.sleep(0.05)
        log = service.job_directory(identifier) / "conversion.log"
        details = log.read_text(encoding="utf-8", errors="replace") if log.exists() else ""
        self.assertEqual(status["state"], "completed", f"{status}\n{details}")
        process = service._processes.get(identifier)
        if process is not None:
            process.wait(timeout=3)
        deadline = time.monotonic() + 3
        while identifier in service._processes and time.monotonic() < deadline:
            time.sleep(0.01)

