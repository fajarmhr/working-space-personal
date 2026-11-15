"""Offline OCR contract and a real scanned-page to editable-DOCX regression."""
import math
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, skipUnless
from unittest.mock import patch
from zipfile import ZipFile

import pymupdf
from docx import Document

from workspace import pdf_ocr
from workspace.tests.test_pdf_conversion import sample_pdf


MODELS = Path(__file__).resolve().parents[3] / ".runtime" / "ocr" / "tessdata"
HAS_MODELS = all((MODELS / f"{language}.traineddata").is_file() for language in ("eng", "ind"))


def scanned_pdf(content: bytes) -> bytes:
    """Rasterize a real layout so the input contains zero searchable text."""
    with pymupdf.open(stream=content, filetype="pdf") as digital, pymupdf.open() as scans:
        for page in digital:
            raster = page.get_pixmap(dpi=180, alpha=False)
            scan = scans.new_page(width=page.rect.width, height=page.rect.height)
            scan.insert_image(scan.rect, pixmap=raster)
        return scans.tobytes()


class PdfOcrTests(TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory(prefix="ruang-ocr-tests-")
        self.addCleanup(self.temporary.cleanup)
        self.folder = Path(self.temporary.name)
        self.source = self.folder / "source.pdf"
        self.output = self.folder / "normalized.pdf"

    def test_auto_preserves_digital_pages_without_loading_models(self):
        self.source.write_bytes(sample_pdf())
        with patch.object(pdf_ocr, "tessdata_directory", side_effect=AssertionError("No OCR needed")):
            result = pdf_ocr.convert_scanned_pages(self.source, self.output)
        self.assertEqual(result, {"pages": [], "warnings": []})
        with pymupdf.open(self.source) as original, pymupdf.open(self.output) as copied:
            self.assertEqual(copied.page_count, 2)
            for before, after in zip(original, copied):
                self.assertEqual(before.get_text(), after.get_text())
                self.assertEqual(before.get_pixmap().samples, after.get_pixmap().samples)

    def test_off_preserves_scans_without_loading_models_or_claiming_ocr(self):
        self.source.write_bytes(scanned_pdf(sample_pdf()))
        with patch.object(pdf_ocr, "tessdata_directory", side_effect=AssertionError("OCR disabled")):
            result = pdf_ocr.convert_scanned_pages(self.source, self.output, mode="off")
        self.assertEqual(result["pages"], [])
        with pymupdf.open(self.output) as copied:
            self.assertEqual(copied[0].get_text(), "")
            self.assertEqual(len(copied[0].get_images()), 1)

    def test_invalid_options_and_same_path_are_rejected(self):
        for options in ({"mode": "online"}, {"language": "../../eng"}):
            with self.subTest(options=options), self.assertRaises(ValueError):
                pdf_ocr.convert_scanned_pages(self.source, self.output, **options)
        with self.assertRaisesRegex(ValueError, "berbeda"):
            pdf_ocr.convert_scanned_pages(self.source, self.source)

    def test_missing_models_are_actionable_and_leave_no_partial_output(self):
        self.source.write_bytes(scanned_pdf(sample_pdf()))
        with patch.dict(os.environ, {"RUANG_OCR_TESSDATA": str(self.folder / "missing")}):
            with self.assertRaisesRegex(ValueError, "setup-ocr.ps1"):
                pdf_ocr.convert_scanned_pages(self.source, self.output)
        self.assertFalse(self.output.exists())

    def test_corrupt_model_is_rejected_before_native_ocr(self):
        (self.folder / "eng.traineddata").write_bytes(b"not a verified trained model")
        with patch.dict(os.environ, {"RUANG_OCR_TESSDATA": str(self.folder)}):
            with self.assertRaisesRegex(ValueError, "diverifikasi"):
                pdf_ocr.tessdata_directory("eng")

    def test_render_resolution_is_bounded_even_for_large_pages(self):
        for rectangle in (pymupdf.Rect(0, 0, 595, 842), pymupdf.Rect(0, 0, 14400, 14400)):
            dpi = pdf_ocr._render_dpi(rectangle)
            self.assertLessEqual(dpi, 300)
            self.assertLessEqual(math.ceil(rectangle.width * dpi / 72)
                                 * math.ceil(rectangle.height * dpi / 72), pdf_ocr.MAX_RENDER_PIXELS)
        with self.assertRaisesRegex(ValueError, "Ukuran halaman"):
            pdf_ocr._render_dpi(pymupdf.Rect(0, 0, 14401, 200))

    def test_page_limit_is_checked_before_loading_models(self):
        with pymupdf.open() as document:
            for _ in range(101):
                document.new_page()
            document.save(self.source)
        with self.assertRaisesRegex(ValueError, "100 halaman"):
            pdf_ocr.convert_scanned_pages(self.source, self.output)

    @skipUnless(HAS_MODELS, "Run scripts/setup-ocr.ps1 to install offline OCR models")
    def test_real_scan_recovers_visible_text_columns_table_and_figure_into_docx(self):
        self.source.write_bytes(scanned_pdf(sample_pdf()))
        callbacks = []
        with patch.dict(os.environ, {"RUANG_OCR_TESSDATA": str(MODELS)}):
            result = pdf_ocr.convert_scanned_pages(
                self.source, self.output, on_page=lambda page, total: callbacks.append((page, total))
            )
        self.assertEqual(result["pages"], [1, 2])
        self.assertEqual(callbacks, [(1, 2), (2, 2)])
        self.assertTrue(any("Periksa ejaan" in warning for warning in result["warnings"]))
        with pymupdf.open(self.output) as normalized:
            first = normalized[0]
            text = first.get_text()
            for expected in ("Laporan Proyek Ruang", "Kolom kanan", "Dokumentasi", "Berjalan", "12"):
                self.assertIn(expected, text)
            self.assertIn("Kolom Kiri", text)
            self.assertIn("Halaman Kedua", normalized[1].get_text())
            self.assertEqual(len(first.get_drawings()), 8)
            images = first.get_image_info()
            self.assertEqual(len(images), 1, "Only the illustration crop should remain, never text or table images")
            self.assertLess(pymupdf.Rect(images[0]["bbox"]).get_area(), first.rect.get_area() * 0.1)
            for trace in first.get_texttrace():
                self.assertEqual(trace["type"], 0, "OCR text must be visible, not an invisible text layer")
            # Both columns retain independent horizontal positions.
            left = first.search_for("Kolom Kiri")[0]
            right = first.search_for("Kolom kanan")[0]
            self.assertGreater(right.x0 - left.x0, 200)
        from pdf2docx import Converter

        destination = self.folder / "editable.docx"
        converter = Converter(str(self.output))
        try:
            converter.convert(str(destination), multi_processing=False)
        finally:
            converter.close()
        document = Document(destination)
        self.assertEqual(len(document.tables), 1)
        self.assertEqual([[cell.text.strip() for cell in row.cells] for row in document.tables[0].rows], [
            ["Pekerjaan", "Status", "Jumlah"], ["Dokumentasi", "Selesai", "7"],
            ["Pemeriksaan", "Berjalan", "12"],
        ])
        # Joining individual XML nodes with spaces hides missing Word spaces.
        # paragraph.text reproduces exactly what Word receives between its runs.
        text = "\n".join(paragraph.text for paragraph in document.paragraphs)
        for expected in ("Laporan Proyek Ruang", "Kolom Kiri", "Kolom kanan",
                         "Rencana pekerjaan dan hasil pemeriksaan.",
                         "Data harus tetap dapat diedit di Word.", "Halaman Kedua"):
            self.assertIn(expected, text)
        with ZipFile(destination) as archive:
            self.assertTrue(any(name.startswith("word/media/") for name in archive.namelist()))

    @skipUnless(HAS_MODELS, "Offline OCR models required")
    def test_word_font_metrics_fit_the_original_body_line_width(self):
        lines = ("Pemeriksaan dokumen selesai. Jumlah pekerjaan: 27.",
                 "Indonesia and English OCR test. Editable document.")
        with pymupdf.open() as document:
            page = document.new_page(width=595, height=842)
            page.insert_text((50, 70), "Laporan Pekerjaan Harian", fontsize=26)
            for y, line in zip((113, 143), lines):
                page.insert_text((50, y), line, fontsize=14)
            self.source.write_bytes(scanned_pdf(document.tobytes()))
        with patch.dict(os.environ, {"RUANG_OCR_TESSDATA": str(MODELS)}):
            pdf_ocr.convert_scanned_pages(self.source, self.output)
        from pdf2docx import Converter

        destination = self.folder / "line-width.docx"
        converter = Converter(str(self.output))
        try:
            converter.convert(str(destination), multi_processing=False)
        finally:
            converter.close()
        document = Document(destination)
        section = document.sections[0]
        font = pymupdf.Font("helv")
        found = set()
        for paragraph in document.paragraphs:
            available = (section.page_width - section.left_margin - section.right_margin
                         - (paragraph.paragraph_format.left_indent or 0)
                         - (paragraph.paragraph_format.right_indent or 0)) / 12700
            for run in paragraph.runs:
                if run.text.strip() not in lines:
                    continue
                found.add(run.text.strip())
                # Word uses natural glyph widths, unlike positioned PDF words.
                # These runs must fit before Word can preserve the scan's lines.
                self.assertLessEqual(font.text_length(run.text, fontsize=run.font.size.pt), available)
        self.assertEqual(found, set(lines))

    @skipUnless(HAS_MODELS, "Offline OCR models required")
    def test_auto_ocr_only_scan_page_in_mixed_document_and_preserves_blank(self):
        with pymupdf.open(stream=sample_pdf(), filetype="pdf") as fixture, pymupdf.open() as mixed:
            mixed.insert_pdf(fixture, from_page=1, to_page=1)
            page = mixed.new_page(width=595, height=842)
            page.insert_image(page.rect, pixmap=fixture[1].get_pixmap(dpi=150))
            mixed.new_page()
            mixed.save(self.source)
        with patch.dict(os.environ, {"RUANG_OCR_TESSDATA": str(MODELS)}):
            result = pdf_ocr.convert_scanned_pages(self.source, self.output)
        self.assertEqual(result["pages"], [2])
        with pymupdf.open(self.source) as source, pymupdf.open(self.output) as output:
            self.assertEqual(source[0].get_pixmap().samples, output[0].get_pixmap().samples)
            self.assertIn("Halaman Kedua", output[1].get_text())
            self.assertEqual(output[2].get_text(), "")
            self.assertEqual(output[2].get_images(), [])

    @skipUnless(HAS_MODELS, "Offline OCR models required")
    def test_force_recognizes_digital_and_blank_pages_without_hallucination(self):
        with pymupdf.open() as document:
            document.new_page().insert_text((40, 70), "Pemeriksaan dokumen selesai.", fontsize=16)
            document.new_page()
            document.save(self.source)
        with patch.dict(os.environ, {"RUANG_OCR_TESSDATA": str(MODELS)}):
            result = pdf_ocr.convert_scanned_pages(self.source, self.output, mode="force", language="eng")
        self.assertEqual(result["pages"], [1, 2])
        self.assertTrue(any("Halaman 2" in warning and "tidak menemukan teks" in warning
                            for warning in result["warnings"]))
        with pymupdf.open(self.output) as output:
            self.assertIn("Pemeriksaan", output[0].get_text())
            self.assertEqual(output[1].get_text(), "")
            self.assertEqual(output[1].get_images(), [])

    @skipUnless(HAS_MODELS, "Offline OCR models required")
    def test_digital_header_does_not_hide_a_large_scan_on_the_same_page(self):
        with pymupdf.open(stream=sample_pdf(), filetype="pdf") as fixture, pymupdf.open() as document:
            page = document.new_page(width=595, height=842)
            page.insert_text((40, 30), "Digital page header", fontsize=14)
            page.insert_image(pymupdf.Rect(0, 70, 595, 842), pixmap=fixture[1].get_pixmap(dpi=180))
            document.save(self.source)
        with patch.dict(os.environ, {"RUANG_OCR_TESSDATA": str(MODELS)}):
            result = pdf_ocr.convert_scanned_pages(self.source, self.output)
        self.assertEqual(result["pages"], [1])
        with pymupdf.open(self.output) as output:
            self.assertIn("Digital page header", output[0].get_text())
            self.assertIn("Halaman Kedua", output[0].get_text())
