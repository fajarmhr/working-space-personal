"""Bounded editable PDF conversion with optional local OCR."""
from __future__ import annotations

import argparse
import os
import sys
import traceback
from pathlib import Path
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

from workspace.pdf_conversion import (  # noqa: E402
    MAX_PDF_PAGES,
    fail_job,
    job_directory,
    read_status,
    write_status,
)


class PdfConversionError(ValueError):
    pass


def inspect_pdf(path: Path, *, allow_ocr: bool = False) -> tuple[int, list[str]]:
    import pymupdf

    warnings: list[str] = []
    try:
        with pymupdf.open(path) as document:
            if not document.is_pdf:
                raise PdfConversionError("Berkas tidak dapat dibaca sebagai PDF.")
            if document.is_encrypted or document.needs_pass:
                raise PdfConversionError("PDF dilindungi sandi. Buka proteksinya terlebih dahulu lalu unggah kembali.")
            count = document.page_count
            if count < 1:
                raise PdfConversionError("PDF tidak memiliki halaman.")
            if count > MAX_PDF_PAGES:
                raise PdfConversionError("PDF maksimal 100 halaman. Pecah dokumen menjadi bagian lebih kecil.")
            scanned = []
            characters = 0
            for index, page in enumerate(document):
                if page.rect.is_empty or page.rect.is_infinite or max(page.rect.width, page.rect.height) > 14400:
                    raise PdfConversionError("Ukuran halaman PDF terlalu besar atau tidak valid.")
                images = page.get_images(full=True)
                if len(images) > 1000 or any(image[2] * image[3] > 40_000_000 for image in images):
                    raise PdfConversionError("Gambar di PDF terlalu besar atau kompleks. Kurangi resolusi lalu coba lagi.")
                text = page.get_text("text").strip()
                characters += len(text)
                if not text:
                    scanned.append(index + 1)
                if characters > 2_000_000:
                    raise PdfConversionError("Isi PDF terlalu besar. Pecah dokumen menjadi bagian lebih kecil.")
            if characters == 0 and not allow_ocr:
                raise PdfConversionError(
                    "PDF tidak memiliki teks yang dapat diedit, kemungkinan hasil scan. "
                    "Aktifkan OCR otomatis lalu coba lagi."
                )
            if scanned and not allow_ocr:
                shown = ", ".join(map(str, scanned[:12])) + (" dan lainnya" if len(scanned) > 12 else "")
                warnings.append(f"Halaman {shown} tidak memiliki teks terdeteksi; isi scan tidak menjadi teks editable.")
            warnings.append("Font yang tidak tersedia di komputer dapat diganti saat dokumen dibuka di Word.")
            warnings.append("Periksa kembali posisi tabel, kolom, header/footer, dan pemisahan halaman sebelum memakai hasil.")
            return count, warnings
    except PdfConversionError:
        raise
    except Exception as exc:
        raise PdfConversionError("PDF rusak atau belum didukung. Coba ekspor ulang PDF dari aplikasi sumber.") from exc


def verify_docx(path: Path) -> None:
    if not path.is_file() or path.stat().st_size > 200 * 1024 * 1024:
        raise PdfConversionError("Hasil DOCX terlalu besar atau tidak terbentuk. Kurangi jumlah halaman PDF.")
    try:
        with ZipFile(path) as document:
            names = set(document.namelist())
            if not {"[Content_Types].xml", "word/document.xml"}.issubset(names) or document.testzip():
                raise PdfConversionError("Hasil DOCX gagal diverifikasi.")
            if document.getinfo("word/document.xml").file_size > 32 * 1024 * 1024:
                raise PdfConversionError("Struktur DOCX terlalu besar. Kurangi jumlah halaman PDF.")
            content = document.read("word/document.xml")
            root = ElementTree.fromstring(content)
            text_nodes = root.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t")
            if not any((node.text or "").strip() for node in text_nodes):
                raise PdfConversionError("Konversi tidak menghasilkan teks editable. Aktifkan OCR untuk scan dan pastikan tulisannya cukup jelas.")
    except (BadZipFile, KeyError, OSError, ElementTree.ParseError) as exc:
        raise PdfConversionError("Hasil DOCX gagal diverifikasi.") from exc


def convert_editable(source: Path, destination: Path) -> None:
    from pdf2docx import Converter

    converter = Converter(str(source))
    try:
        # One subprocess already isolates the job. Internal multiprocessing would
        # escape its time limit and increase memory pressure on personal machines.
        converter.convert(str(destination), multi_processing=False)
    finally:
        converter.close()


def run_job(job_id: str) -> None:
    directory = job_directory(job_id)
    source = directory / "source.pdf"
    pending = directory / ".result-pending.docx"
    normalized = directory / '.ocr-normalized.pdf'
    if source.is_symlink() or not source.resolve().is_relative_to(directory):
        fail_job(directory, "Lokasi berkas PDF tidak valid.")
        return
    try:
        write_status(directory, {
            "state": "running", "stage": "validating", "progress": None,
            "message": "Memeriksa halaman dan teks PDF.",
        })
        initial = read_status(directory)
        ocr_mode = initial.get('ocr_mode', 'off')
        count, warnings = inspect_pdf(source, allow_ocr=ocr_mode != 'off')
        conversion_source = source
        if ocr_mode != 'off':
            from workspace.pdf_ocr import convert_scanned_pages

            def on_page(page_number, total_pages):
                write_status(directory, {
                    'stage': 'ocr', 'page_count': count,
                    'message': f'Membaca scan dengan OCR lokal: halaman {page_number} dari {total_pages}.',
                })

            result = convert_scanned_pages(
                source, normalized, mode=ocr_mode,
                language=initial.get('ocr_language', 'eng+ind'), on_page=on_page,
            )
            warnings.extend(result['warnings'])
            write_status(directory, {'ocr_pages': result['pages']})
            if result['pages']:
                conversion_source = normalized
        write_status(directory, {
            "stage": "converting", "page_count": count,
            "message": "Menyusun teks, tabel, dan gambar ke DOCX editable.",
            "warnings": [*initial["warnings"], *warnings],
        })
        convert_editable(conversion_source, pending)
        write_status(directory, {"stage": "verifying", "message": "Memverifikasi berkas DOCX hasil konversi."})
        verify_docx(pending)
        os.replace(pending, directory / "result.docx")
        write_status(directory, {
            "state": "completed", "stage": "completed", "progress": 100,
            "message": "DOCX editable siap diunduh.", "error": None,
        })
    except PdfConversionError as exc:
        fail_job(directory, str(exc))
    except ValueError as exc:
        fail_job(directory, str(exc))
    except Exception:
        traceback.print_exc()
        fail_job(directory, "Konversi PDF belum berhasil. Coba PDF yang lebih sederhana atau ekspor ulang dari sumber.")
    finally:
        pending.unlink(missing_ok=True)
        normalized.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert one local PDF job to editable DOCX.")
    parser.add_argument("--job", required=True)
    arguments = parser.parse_args()
    if os.environ.pop("RUANG_PDF_START_GATE", "") == "1":
        if sys.stdin.buffer.readline(8) != b"ready\n":
            return
    run_job(arguments.job)


if __name__ == "__main__":
    main()
