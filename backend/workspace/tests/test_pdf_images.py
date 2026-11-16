"""Real raster/export fixtures plus local API and process-boundary checks."""
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
import time
from unittest.mock import patch
from uuid import uuid4
from zipfile import ZipFile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from ninja.errors import HttpError
from PIL import Image
import pymupdf

from workspace import pdf_images as service
from workspace.pdf_images_worker import run_job


def pdf_bytes(*, encrypted=False, large=False):
    with pymupdf.open() as document:
        page = document.new_page(width=10000 if large else 144, height=10000 if large else 72)
        page.draw_rect(pymupdf.Rect(0, 0, 72, 72), color=(1, 0, 0), fill=(1, 0, 0))
        page.draw_rect(pymupdf.Rect(72, 0, 144, 72), color=(0, 0, 1), fill=(0, 0, 1))
        second = document.new_page(width=144, height=72)
        second.draw_rect(pymupdf.Rect(0, 0, 144, 72), color=(0, 0.6, 0), fill=(0, 0.6, 0))
        second.set_rotation(90)
        options = {"encryption": pymupdf.PDF_ENCRYPT_AES_256, "owner_pw": "fixture-owner", "user_pw": "fixture-user"} if encrypted else {}
        return document.tobytes(**options)


def image_bytes(*, mode="RGB", color="red", size=(16, 8), image_format="PNG", orientation=None):
    stream = BytesIO()
    with Image.new(mode, size, color) as image:
        options = {}
        if orientation:
            exif = Image.Exif()
            exif[274] = orientation
            options["exif"] = exif
        image.save(stream, format=image_format, **options)
    return stream.getvalue()


class PdfImageTests(TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory(prefix="ruang-pdf-image-tests-")
        self.settings_override = override_settings(DATA_DIR=Path(self.temporary.name))
        self.settings_override.enable()
        self.client = Client(enforce_csrf_checks=True, HTTP_HOST="127.0.0.1:8000")
        self.token = self.client.get("/api/bootstrap").json()["csrf_token"]

    def tearDown(self):
        service.stop_workers()
        service._processes.clear()
        service._lifetimes.clear()
        self.settings_override.disable()
        self.temporary.cleanup()

    def import_sync(self, *, dpi=300, content=None):
        directory, _ = service._new_job("import", "fixture.pdf", dpi=dpi)
        (directory / "source.pdf").write_bytes(content if content is not None else pdf_bytes())
        run_job(directory.name)
        return directory, service.get_job(directory.name)

    def add_image(self, content=None, dpi=300, name="image.png"):
        return service.add_asset(SimpleUploadedFile(name, content or image_bytes()), dpi)

    def export_sync(self, assets, **options):
        with patch.object(service, "_launch", side_effect=lambda directory, status: service.public_status(status)):
            job = service.create_export([
                {"job_id": asset["job_id"], "id": asset["id"]} for asset in assets
            ], **options)
        run_job(job["id"])
        self.assertEqual(service.get_job(job["id"])["state"], "completed")
        return service.completed_result(job["id"])

    def test_real_render_preserves_dpi_page_rotation_and_separate_thumbnails(self):
        for dpi, first_size, second_size in ((300, (600, 300), (300, 600)), (600, (1200, 600), (600, 1200))):
            directory, job = self.import_sync(dpi=dpi)
            self.assertEqual(job["state"], "completed")
            self.assertEqual(len(job["pages"]), 2)
            for page, size in zip(job["pages"], (first_size, second_size)):
                path, metadata = service.asset_path(directory.name, page["id"])
                with Image.open(path) as image:
                    self.assertEqual(image.size, size)
                    self.assertAlmostEqual(image.info["dpi"][0], dpi, delta=0.1)
                    if page["source_page"] == 1:
                        self.assertEqual(image.getpixel((size[0] // 4, size[1] // 2)), (255, 0, 0))
                        self.assertEqual(image.getpixel((3 * size[0] // 4, size[1] // 2)), (0, 0, 255))
                thumbnail, _ = service.asset_path(directory.name, page["id"], thumbnail=True)
                with Image.open(thumbnail) as image:
                    self.assertLessEqual(max(image.size), 320)
                self.assertEqual(metadata["dpi"], dpi)
                self.assertTrue(page["image_url"].endswith(page["id"]))

    def test_password_invalid_and_oversized_pages_fail_without_silent_downscale(self):
        for data, part in ((pdf_bytes(encrypted=True), "sandi"), (b"%PDF-broken", "rusak"), (pdf_bytes(large=True), "DPI lebih rendah")):
            with self.subTest(part=part):
                _, job = self.import_sync(dpi=600, content=data)
                self.assertEqual(job["state"], "failed")
                self.assertEqual(job["pages"], [])
                self.assertIn(part, job["error"])

    def test_added_image_normalizes_exif_and_preserves_alpha_without_metadata(self):
        asset = self.add_image(image_bytes(image_format="JPEG", orientation=6), name="rotated.jpg")
        self.assertEqual((asset["width"], asset["height"]), (8, 16))
        path, _ = service.asset_path(asset["job_id"], asset["id"])
        with Image.open(path) as image:
            self.assertFalse(image.getexif())
        alpha = self.add_image(image_bytes(mode="RGBA", color=(0, 0, 0, 0)), dpi=600)
        path, _ = service.asset_path(alpha["job_id"], alpha["id"])
        with Image.open(path) as image:
            self.assertEqual(image.mode, "RGBA")
            self.assertEqual(image.getpixel((0, 0))[3], 0)
            self.assertAlmostEqual(image.info["dpi"][0], 600, delta=0.1)

    def test_export_formats_keep_dimensions_dpi_and_transparency_policy(self):
        asset = self.add_image(image_bytes(mode="RGBA", color=(0, 0, 0, 0)), dpi=600)
        for output_format, extension, mime in (("png", "png", "image/png"), ("jpeg", "jpg", "image/jpeg"), ("tiff", "tif", "image/tiff"), ("webp", "webp", "image/webp")):
            with self.subTest(format=output_format):
                path, name, content_type = self.export_sync([asset], image_format=output_format, bundle=False, webp_lossless=True)
                self.assertTrue(name.endswith("." + extension))
                self.assertEqual(content_type, mime)
                with Image.open(path) as image:
                    self.assertEqual(image.size, (16, 8))
                    if output_format != "webp":
                        self.assertAlmostEqual(image.info["dpi"][0], 600, delta=1)
                    if output_format == "jpeg":
                        self.assertEqual(image.getpixel((0, 0)), (255, 255, 255))
                    else:
                        self.assertEqual(image.getpixel((0, 0))[3], 0)

    def test_zip_matches_exact_selected_order_including_added_and_duplicate_pages(self):
        red = self.add_image(image_bytes(color="red"))
        blue = self.add_image(image_bytes(color="blue"))
        self.add_image(image_bytes(color="green"))  # Deleted/unselected source must not appear.
        path, _, mime = self.export_sync([blue, red, blue], image_format="png")
        self.assertEqual(mime, "application/zip")
        with ZipFile(path) as archive:
            self.assertIsNone(archive.testzip())
            self.assertEqual(archive.namelist(), ["halaman-001.png", "halaman-002.png", "halaman-003.png"])
            for name, color in zip(archive.namelist(), ((0, 0, 255), (255, 0, 0), (0, 0, 255))):
                with Image.open(BytesIO(archive.read(name))) as image:
                    self.assertEqual(image.getpixel((0, 0)), color)

    def test_local_api_csrf_input_bounds_and_asset_paths(self):
        upload = lambda content, name="source.pdf": SimpleUploadedFile(name, content)
        self.assertEqual(self.client.post("/api/pdf-images/import", {"file": upload(pdf_bytes())}).status_code, 403)
        self.assertEqual(self.client.post("/api/pdf-images/assets", {"file": upload(image_bytes(), "picture.png")}).status_code, 403)
        self.assertEqual(self.client.post("/api/pdf-images/export", data="{}", content_type="application/json").status_code, 403)
        with patch.object(service, "_launch") as launch:
            for data, name, dpi in ((b"", "empty.pdf", 300), (b"not pdf", "wrong.pdf", 300), (pdf_bytes(), "wrong.txt", 300), (pdf_bytes(), "source.pdf", 900)):
                response = self.client.post("/api/pdf-images/import", {"file": upload(data, name), "dpi": dpi}, HTTP_X_CSRFTOKEN=self.token)
                self.assertEqual(response.status_code, 422)
            launch.assert_not_called()
        asset = self.add_image()
        response = self.client.get(asset["image_url"])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "image/png")
        response.close()
        preview = self.client.get(asset["thumbnail_url"])
        self.assertEqual(preview.status_code, 200)
        preview.close()
        for invalid in ("../bad", "invalid", str(uuid4()).upper()):
            with self.subTest(id=invalid), self.assertRaises(HttpError):
                service.asset_path(invalid, asset["id"])
        with self.assertRaises(HttpError):
            service.asset_path(asset["job_id"], str(uuid4()))
        with patch.object(service, "MAX_ASSET_BYTES", 4):
            self.assertEqual(self.client.post("/api/pdf-images/assets", {"file": upload(image_bytes(), "picture.png")}, HTTP_X_CSRFTOKEN=self.token).status_code, 413)

    def test_export_rejects_foreign_bad_references_and_limit_bypass(self):
        asset = self.add_image()
        reference = {"job_id": asset["job_id"], "id": asset["id"]}
        cases = [([], {}), ([reference], {"quality": True}), ([reference], {"image_format": "svg"}), ([reference, reference], {"bundle": False}), ([{**reference, "path": "secret"}], {})]
        for pages, options in cases:
            with self.subTest(options=options), self.assertRaises(HttpError):
                service.create_export(pages, **options)
        with patch.object(service, "MAX_TOTAL_PIXELS", 1), self.assertRaises(HttpError):
            service.create_export([reference])
        for value in (({"job_id": "../other", "id": asset["id"]}), ({"job_id": asset["job_id"], "id": "../../other"})):
            with self.assertRaises(HttpError):
                service.create_export([value])

    def test_active_jobs_restart_deadline_and_launch_failure_are_actionable(self):
        directory, _ = service._new_job("import", "pending.pdf", dpi=300)
        with self.assertRaises(HttpError) as busy:
            service.create_import(SimpleUploadedFile("new.pdf", pdf_bytes()))
        self.assertEqual(busy.exception.status_code, 409)
        service.write_status(directory, {"deadline_at": (datetime.now(timezone.utc) - timedelta(seconds=30)).isoformat()})
        self.assertEqual(service.get_job(directory.name)["state"], "failed")
        with patch.object(service.subprocess, "Popen", side_effect=OSError("fixture cannot launch")):
            job = service.create_import(SimpleUploadedFile("../example.pdf", pdf_bytes()))
        self.assertEqual(job["state"], "failed")
        self.assertEqual(job["filename"], "example.pdf")
        self.assertIn("Worker gambar", job["error"])

    def test_api_single_export_round_trip_with_worker_run(self):
        import json
        asset = self.add_image()
        with patch.object(service, "_launch", side_effect=lambda directory, status: service.public_status(status)):
            response = self.client.post("/api/pdf-images/export", data=json.dumps({"pages": [{"job_id": asset["job_id"], "id": asset["id"]}], "format": "jpeg", "bundle": False}), content_type="application/json", HTTP_X_CSRFTOKEN=self.token)
        self.assertEqual(response.status_code, 202)
        identifier = response.json()["id"]
        run_job(identifier)
        result = self.client.get(f"/api/pdf-images/jobs/{identifier}")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["state"], "completed")
        download = self.client.get(result.json()["download_url"])
        self.assertEqual(download.status_code, 200)
        self.assertEqual(download["Content-Type"], "image/jpeg")
        with Image.open(BytesIO(b"".join(download.streaming_content))) as image:
            self.assertEqual(image.size, (16, 8))

    def test_actual_worker_is_supervised_and_finishes_local_import(self):
        job = service.create_import(SimpleUploadedFile("fixture.pdf", pdf_bytes()), dpi=150)
        deadline = time.monotonic() + 12
        while job["state"] in service.ACTIVE_STATES and time.monotonic() < deadline:
            time.sleep(0.05)
            job = service.get_job(job["id"])
        self.assertEqual(job["state"], "completed", job)
        self.assertEqual(len(job["pages"]), 2)
