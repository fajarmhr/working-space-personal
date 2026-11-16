"""Render one PDF or encode one ordered image selection in an isolated worker."""
from __future__ import annotations

import argparse
import math
import os
import sys
import traceback
import warnings
from pathlib import Path
from uuid import uuid4
from zipfile import ZIP_DEFLATED, ZipFile

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

from workspace import pdf_images as service


def validate_dimensions(width: int, height: int):
    if width < 1 or height < 1 or max(width, height) > service.MAX_SIDE or width * height > service.MAX_PAGE_PIXELS:
        raise ValueError("Halaman melebihi 40 megapiksel atau sisi 8.192 px. Pilih DPI lebih rendah atau halaman lebih kecil.")


def _verify_size(path: Path, *, limit=service.MAX_ASSET_BYTES):
    if path.stat().st_size > limit:
        raise ValueError("Berkas hasil terlalu besar. Kurangi DPI, kualitas, atau jumlah halaman.")


def _thumbnail(image, destination: Path):
    from PIL import Image
    preview = image.copy()
    try:
        preview.thumbnail((320, 320), Image.Resampling.LANCZOS)
        preview.save(destination, format="PNG", optimize=False)
    finally:
        preview.close()


def normalize_image(source: Path, directory: Path, dpi: int, name: str) -> dict:
    from PIL import Image, ImageOps, UnidentifiedImageError
    identifier = str(uuid4())
    target = directory / f"{identifier}.png"
    thumbnail = directory / f"{identifier}-thumb.png"
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(source) as opened:
                if opened.format not in {"PNG", "JPEG", "WEBP"}:
                    raise ValueError("Tambahkan gambar PNG, JPEG, atau WebP.")
                validate_dimensions(*opened.size)
                opened.load()
                image = ImageOps.exif_transpose(opened)
                try:
                    validate_dimensions(*image.size)
                    normalized = image.convert("RGBA" if "A" in image.getbands() or "transparency" in image.info else "RGB")
                    try:
                        normalized.info.clear()
                        normalized.save(target, format="PNG", dpi=(dpi, dpi), optimize=False)
                        _verify_size(target)
                        _thumbnail(normalized, thumbnail)
                        return {"id": identifier, "name": name, "width": normalized.width, "height": normalized.height, "dpi": dpi, "source_page": None, "size": target.stat().st_size}
                    finally:
                        normalized.close()
                finally:
                    if image is not opened:
                        image.close()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise ValueError("Gambar rusak, terlalu besar, atau formatnya belum didukung.") from error
    except BaseException:
        target.unlink(missing_ok=True)
        thumbnail.unlink(missing_ok=True)
        raise


def render_pdf(directory: Path, status: dict):
    import pymupdf
    source = directory / "source.pdf"
    if source.is_symlink() or not source.resolve().is_relative_to(directory):
        raise ValueError("Lokasi sumber PDF tidak valid.")
    dpi = status["dpi"]
    try:
        document = pymupdf.open(source)
    except Exception as error:
        raise ValueError("PDF rusak atau belum didukung. Coba ekspor ulang dari sumber.") from error
    with document:
        if not document.is_pdf:
            raise ValueError("Berkas tidak dapat dibaca sebagai PDF.")
        if document.is_encrypted or document.needs_pass:
            raise ValueError("PDF dilindungi sandi. Buka proteksinya sebelum mengimpor.")
        if not 1 <= document.page_count <= service.MAX_PAGES:
            raise ValueError("PDF harus berisi 1 sampai 100 halaman.")
        total_pixels = 0
        for page in document:
            rect = page.rect
            if rect.is_empty or rect.is_infinite or not all(math.isfinite(v) and v > 0 for v in (rect.width, rect.height)):
                raise ValueError("Ukuran halaman PDF tidak valid.")
            width, height = math.ceil(rect.width * dpi / 72), math.ceil(rect.height * dpi / 72)
            validate_dimensions(width, height)
            total_pixels += width * height
        if total_pixels > service.MAX_TOTAL_PIXELS:
            raise ValueError("Total render melebihi 1 gigapiksel. Kurangi DPI atau pecah PDF.")
        pages, output_bytes = [], 0
        base = Path(status["filename"]).stem or "halaman"
        for index, page in enumerate(document):
            identifier = str(uuid4())
            target = directory / f"{identifier}.png"
            thumbnail = directory / f"{identifier}-thumb.png"
            pixmap = page.get_pixmap(dpi=dpi, alpha=False, annots=True)
            try:
                validate_dimensions(pixmap.width, pixmap.height)
                pixmap.save(target)
                _verify_size(target)
                output_bytes += target.stat().st_size
                if output_bytes > service.MAX_OUTPUT_BYTES:
                    raise ValueError("Total hasil render melebihi 512 MB. Kurangi DPI atau jumlah halaman.")
                width, height = pixmap.width, pixmap.height
            finally:
                del pixmap
            scale = min(320 / page.rect.width, 320 / page.rect.height)
            preview = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False, annots=True)
            try:
                preview.save(thumbnail)
            finally:
                del preview
            pages.append({"id": identifier, "name": f"{base} - {index + 1:03d}.png", "width": width, "height": height, "dpi": dpi, "source_page": index + 1, "size": target.stat().st_size})
            service.write_status(directory, {"progress": round((index + 1) * 100 / document.page_count), "message": f"Merender halaman {index + 1} dari {document.page_count} pada {dpi} DPI."})
        service.write_status(directory, {"state": "completed", "progress": 100, "pages": pages, "message": f"{len(pages)} halaman siap diedit dan diekspor.", "error": None})


def encode_image(source: Path, destination: Path, metadata: dict, status: dict):
    from PIL import Image
    image_format = status["format"]
    with Image.open(source) as image:
        validate_dimensions(*image.size)
        image.load()
        dpi = metadata["dpi"]
        if image_format == "jpeg":
            background = Image.new("RGB", image.size, "white")
            try:
                if "A" in image.getbands():
                    background.paste(image, mask=image.getchannel("A"))
                else:
                    converted = image.convert("RGB")
                    try:
                        background.paste(converted)
                    finally:
                        converted.close()
                background.save(destination, format="JPEG", quality=status["quality"], subsampling=0, dpi=(dpi, dpi))
            finally:
                background.close()
        elif image_format == "png":
            image.save(destination, format="PNG", dpi=(dpi, dpi), optimize=False)
        elif image_format == "tiff":
            image.save(destination, format="TIFF", compression="tiff_deflate", dpi=(dpi, dpi))
        else:
            image.save(destination, format="WEBP", quality=status["quality"], lossless=status.get("webp_lossless", False), method=4)
    _verify_size(destination)


def export_images(directory: Path, status: dict):
    references = status["references"]
    pending = directory / ".result-pending"
    encoded = directory / ".page-pending"
    extension = {"jpeg": "jpg", "tiff": "tif"}.get(status["format"], status["format"])
    try:
        if status["bundle"]:
            with ZipFile(pending, "w", compression=ZIP_DEFLATED, compresslevel=4) as archive:
                for index, reference in enumerate(references):
                    source, metadata = service.asset_path(reference["job_id"], reference["id"])
                    encode_image(source, encoded, metadata, status)
                    archive.write(encoded, f"halaman-{index + 1:03d}.{extension}")
                    encoded.unlink()
                    if pending.stat().st_size > service.MAX_OUTPUT_BYTES:
                        raise ValueError("Paket ZIP melebihi 512 MB. Ekspor halaman dalam beberapa bagian.")
                    service.write_status(directory, {"progress": round((index + 1) * 100 / len(references)), "message": f"Mengekspor halaman {index + 1} dari {len(references)}."})
        else:
            reference = references[0]
            source, metadata = service.asset_path(reference["job_id"], reference["id"])
            encode_image(source, pending, metadata, status)
        _verify_size(pending, limit=service.MAX_OUTPUT_BYTES)
        os.replace(pending, directory / "result.bin")
        service.write_status(directory, {"state": "completed", "progress": 100, "message": "Hasil gambar siap diunduh.", "error": None})
    finally:
        pending.unlink(missing_ok=True)
        encoded.unlink(missing_ok=True)


def run_job(identifier: str):
    directory = service.job_directory(identifier)
    try:
        service.write_status(directory, {"state": "running", "message": "Memproses gambar halaman.", "progress": 0})
        status = service.read_status(directory)
        if status["kind"] == "import":
            render_pdf(directory, status)
        elif status["kind"] == "export":
            export_images(directory, status)
        else:
            raise ValueError("Jenis pekerjaan gambar tidak didukung.")
    except ValueError as error:
        service.fail_job(directory, str(error))
    except Exception:
        traceback.print_exc()
        service.fail_job(directory, "Pemrosesan gambar belum berhasil. Kurangi DPI atau jumlah halaman lalu coba lagi.")


def main():
    parser = argparse.ArgumentParser(description="Run one local PDF-image job.")
    parser.add_argument("--job", required=True)
    args = parser.parse_args()
    if os.environ.pop("RUANG_PDF_IMAGES_START_GATE", "") == "1" and sys.stdin.buffer.readline(8) != b"ready\n":
        return
    run_job(args.job)


if __name__ == "__main__":
    main()
