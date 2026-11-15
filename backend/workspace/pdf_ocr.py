"""Local scan normalization for pdf2docx: visible text, rules and figure crops.

The original scan is never used as a page-sized image in the output. Tesseract
supplies word positions; ordinary PDF fonts make that text editable in Word.
Recognition and the recovery of tables / illustrations are best effort.
"""
from __future__ import annotations

import math
import os
import hashlib
import json
from pathlib import Path
from typing import Callable

import pymupdf


MAX_RENDER_PIXELS = 20_000_000
MAX_PAGES = 100
MAX_CHARACTERS = 2_000_000
OCR_DPI = 300
LANGUAGES = {"eng+ind", "eng", "ind"}


def tessdata_directory(language: str) -> Path:
    """Resolve only explicitly installed models; never download during a job."""
    directory = Path(os.environ.get(
        "RUANG_OCR_TESSDATA", str(Path(__file__).resolve().parents[2] / ".runtime" / "ocr" / "tessdata")
    ))
    missing = [name for name in language.split("+") if not (directory / f"{name}.traineddata").is_file()]
    if missing:
        raise ValueError(
            f"Model OCR {', '.join(missing)} belum terpasang. "
            "Jalankan scripts/setup-ocr.ps1 untuk memasang model OCR lokal, lalu coba lagi."
        )
    manifest = Path(__file__).resolve().parents[2] / "scripts" / "ocr-models.json"
    try:
        models = {entry["language"]: entry["sha256"] for entry in json.loads(manifest.read_text())["models"]}
        for name in language.split("+"):
            with (directory / f"{name}.traineddata").open("rb") as model:
                digest = hashlib.file_digest(model, "sha256").hexdigest()
            if digest != models[name]:
                raise ValueError(f"Model OCR {name} rusak atau berbeda dari versi yang didukung.")
    except (OSError, KeyError, TypeError, ValueError) as exc:
        raise ValueError(
            "Model OCR gagal diverifikasi. Jalankan scripts/setup-ocr.ps1 untuk memasang ulang model lokal."
        ) from exc
    return directory


def _meaningful(text: str) -> bool:
    return sum(character.isalnum() for character in text) >= 8 and "\ufffd" not in text


def _needs_ocr(page: pymupdf.Page) -> bool:
    words = page.get_text("words")
    if not _meaningful(" ".join(word[4] for word in words)):
        return bool(page.get_images() or page.get_drawings())
    # A digital header / page number must not hide a large unrecognized scan.
    # Existing searchable scans retain their useful text layer in auto mode.
    for image in page.get_image_info():
        rectangle = pymupdf.Rect(image["bbox"]) & page.rect
        if rectangle.get_area() < page.rect.get_area() * 0.25:
            continue
        inside = " ".join(word[4] for word in words if rectangle.contains(pymupdf.Rect(word[:4])))
        if not _meaningful(inside):
            return True
    return False


def _render_dpi(rectangle: pymupdf.Rect) -> int:
    if (rectangle.is_empty or rectangle.is_infinite
            or not all(math.isfinite(value) for value in rectangle)
            or max(rectangle.width, rectangle.height) > 14400):
        raise ValueError("Ukuran halaman PDF terlalu besar atau tidak valid untuk OCR.")
    dpi = min(OCR_DPI, max(1, int(72 * math.sqrt(MAX_RENDER_PIXELS / rectangle.get_area()))))
    # get_pixmap rounds each edge outward, so leave room for that rounding.
    while math.ceil(rectangle.width * dpi / 72) * math.ceil(rectangle.height * dpi / 72) > MAX_RENDER_PIXELS:
        dpi -= 1
    return max(1, dpi)


def _recognize(pixmap: pymupdf.Pixmap, width: float, height: float,
               language: str, tessdata: Path) -> list[dict]:
    # This is the same embedded-Tesseract path as get_textpage_ocr(full=True),
    # reusing our bounded raster rather than holding two page renders in memory.
    import numpy as np

    raster, ink = _raster_ink(pixmap)
    rules = _grid_rules(ink)
    if rules:
        # Rules confuse Tesseract's page segmentation, especially cell labels.
        # Erase them for recognition only; restore them as PDF vectors below.
        cleaned = raster.copy()
        for x, y, w, h, _ in rules:
            cleaned[max(0, y - 1):y + h + 1, max(0, x - 1):x + w + 1] = 255
        recognition = pymupdf.Pixmap(pymupdf.csRGB, pixmap.width, pixmap.height,
                                    np.ascontiguousarray(cleaned).tobytes(), False)
        recognition.set_dpi(pixmap.xres, pixmap.yres)
    else:
        recognition = pixmap
    data = recognition.pdfocr_tobytes(compress=True, language=language, tessdata=str(tessdata))
    spans = []
    line_number = 0
    with pymupdf.open(stream=data, filetype="pdf") as recognized:
        page = recognized[0]
        scale_x, scale_y = width / page.rect.width, height / page.rect.height
        for block in page.get_text("dict", flags=0)["blocks"]:
            for line in block.get("lines", []):
                line_number += 1
                for span in line["spans"]:
                    text = span["text"].strip()
                    if not text:
                        continue
                    x0, y0, x1, y1 = span["bbox"]
                    spans.append({"text": text, "line": line_number, "bbox": pymupdf.Rect(
                        x0 * scale_x, y0 * scale_y, x1 * scale_x, y1 * scale_y
                    )})
    return spans


def _raster_ink(pixmap: pymupdf.Pixmap):
    import cv2
    import numpy as np

    raster = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, pixmap.n)
    gray = cv2.cvtColor(raster, cv2.COLOR_RGB2GRAY)
    return raster, cv2.threshold(gray, 235, 255, cv2.THRESH_BINARY_INV)[1]


def _grid_rules(ink) -> list[tuple[int, int, int, int, bool]]:
    import cv2

    height, width = ink.shape
    rules = []
    for horizontal in (True, False):
        length = max(24, int((width if horizontal else height) * 0.025))
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (length, 1) if horizontal else (1, length))
        mask = cv2.morphologyEx(ink, cv2.MORPH_OPEN, kernel)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            extent, thickness = (w, h) if horizontal else (h, w)
            if thickness <= max(12, min(width, height) * 0.004) and extent >= thickness * 8:
                rules.append((x, y, w, h, horizontal))
                if len(rules) == 1000:
                    return rules
    return rules


def _recover_graphics(page: pymupdf.Page, pixmap: pymupdf.Pixmap, spans: list[dict]) -> bool:
    """Recover thin grid rules and bounded non-text crops, excluding OCR words."""
    import cv2
    import numpy as np

    raster, ink = _raster_ink(pixmap)
    height, width = ink.shape
    scale_x, scale_y = width / page.rect.width, height / page.rect.height
    removed = np.zeros_like(ink)
    shape = page.new_shape()
    for x, y, w, h, horizontal in _grid_rules(ink):
        cv2.rectangle(removed, (x, y), (x + w, y + h), 255, -1)
        thickness = h if horizontal else w
        if horizontal:
            start, end = (x / scale_x, (y + h / 2) / scale_y), ((x + w) / scale_x, (y + h / 2) / scale_y)
        else:
            start, end = ((x + w / 2) / scale_x, y / scale_y), ((x + w / 2) / scale_x, (y + h) / scale_y)
        shape.draw_line(start, end)
        shape.finish(color=(0, 0, 0), width=max(0.4, thickness / (scale_y if horizontal else scale_x)))
    shape.commit()
    # Remove antialiased text edges as well as their recognized bounding boxes.
    for span in spans:
        box = span["bbox"]
        cv2.rectangle(removed, (max(0, int(box.x0 * scale_x) - 3), max(0, int(box.y0 * scale_y) - 3)),
                      (min(width - 1, math.ceil(box.x1 * scale_x) + 3),
                       min(height - 1, math.ceil(box.y1 * scale_y) + 3)), 255, -1)
    removed = cv2.dilate(removed, np.ones((3, 3), np.uint8))
    residual = cv2.bitwise_and(ink, cv2.bitwise_not(removed))
    grouped = cv2.morphologyEx(residual, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    contours, _ = cv2.findContours(grouped, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    clean = raster.copy()
    clean[removed > 0] = 255
    skipped = False
    kept = 0
    for contour in sorted(contours, key=cv2.contourArea, reverse=True):
        x, y, w, h = cv2.boundingRect(contour)
        if w < 12 or h < 12 or cv2.contourArea(contour) < 144:
            continue
        # Never silently replace editable content with a page-sized screenshot.
        if w * h > width * height * 0.5 or kept >= 64:
            skipped = True
            continue
        crop = clean[y:y + h, x:x + w]
        encoded = cv2.imencode(".png", cv2.cvtColor(crop, cv2.COLOR_RGB2BGR))[1]
        page.insert_image(pymupdf.Rect(x / scale_x, y / scale_y, (x + w) / scale_x, (y + h) / scale_y),
                          stream=encoded.tobytes())
        kept += 1
    return skipped


def _write_visible_text(page: pymupdf.Page, spans: list[dict]) -> None:
    font = pymupdf.Font("helv")
    groups: list[list[dict]] = []
    for span in spans:
        if not groups:
            groups.append([span])
            continue
        previous = groups[-1][-1]
        gap = span["bbox"].x0 - previous["bbox"].x1
        if (span["line"] != previous["line"]
                or gap > max(12, max(span["bbox"].height, previous["bbox"].height) * 1.8)):
            groups.append([span])
        else:
            groups[-1].append(span)
    for group in groups:
        text = " ".join(span["text"] for span in group)
        rectangle = pymupdf.Rect(group[0]["bbox"])
        for span in group[1:]:
            rectangle |= span["bbox"]
        if rectangle.is_empty or rectangle.is_infinite:
            continue
        length = font.text_length(text, fontsize=1)
        if length <= 0:
            continue
        # Natural font metrics survive PDF -> Word. Horizontal per-word morphs
        # do not: Word reflows their unscaled glyphs and creates extra wrapping.
        # A little width slack covers Word's half-point font-size rounding.
        size = max(3, min(96, rectangle.height * 1.8, rectangle.width / length * 0.97))
        origin = pymupdf.Point(rectangle.x0, rectangle.y1)
        page.insert_text(origin, text, fontsize=size, fontname="helv", color=(0, 0, 0), render_mode=0)


def convert_scanned_pages(source: Path, destination: Path, mode: str = "auto",
                          language: str = "eng+ind",
                          on_page: Callable[[int, int], None] | None = None) -> dict:
    """Write a normalized PDF and return 1-based OCR page numbers / warnings.

    Auto copies digital pages directly. Off copies every page without loading
    models. Force recognizes every page. The callback runs before each OCR page.
    ValueError messages are suitable for presenting to the local user.
    """
    if mode not in {"auto", "off", "force"}:
        raise ValueError("Mode OCR harus auto, off, atau force.")
    if language not in LANGUAGES:
        raise ValueError("Bahasa OCR harus eng+ind, eng, atau ind.")
    source, destination = Path(source), Path(destination)
    if source.resolve() == destination.resolve():
        raise ValueError("Berkas hasil OCR harus berbeda dari PDF sumber.")
    pages: list[int] = []
    warnings: list[str] = []
    tessdata = None
    characters = 0
    try:
        with pymupdf.open(source) as original, pymupdf.open() as normalized:
            if not original.is_pdf or original.needs_pass or original.is_encrypted:
                raise ValueError("OCR memerlukan PDF yang valid dan tidak dilindungi sandi.")
            if not 1 <= original.page_count <= MAX_PAGES:
                raise ValueError("PDF OCR maksimal 100 halaman. Pecah dokumen menjadi bagian lebih kecil.")
            for index, page in enumerate(original):
                characters += len(page.get_text())
                if characters > MAX_CHARACTERS:
                    raise ValueError("Isi PDF terlalu besar. Pecah dokumen menjadi bagian lebih kecil.")
                if mode == "off" or (mode == "auto" and not _needs_ocr(page)):
                    normalized.insert_pdf(original, from_page=index, to_page=index)
                    continue
                if tessdata is None:
                    tessdata = tessdata_directory(language)
                if on_page:
                    on_page(index + 1, original.page_count)
                dpi = _render_dpi(page.rect)
                images = page.get_images(full=True)
                if len(images) > 1000 or any(image[2] * image[3] > 40_000_000 for image in images):
                    raise ValueError("Gambar di PDF terlalu besar atau kompleks untuk OCR. Kurangi resolusi lalu coba lagi.")
                if dpi < OCR_DPI:
                    warnings.append(f"Halaman {index + 1}: resolusi OCR diturunkan ke {dpi} dpi agar penggunaan memori terbatas.")
                pixmap = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csRGB, alpha=False)
                spans = _recognize(pixmap, page.rect.width, page.rect.height, language, tessdata)
                characters += sum(len(span["text"]) for span in spans)
                if characters > MAX_CHARACTERS:
                    raise ValueError("Teks hasil OCR terlalu besar. Pecah dokumen menjadi bagian lebih kecil.")
                replacement = normalized.new_page(width=page.rect.width, height=page.rect.height)
                if _recover_graphics(replacement, pixmap, spans):
                    warnings.append(f"Halaman {index + 1}: sebagian gambar kompleks tidak dapat dipulihkan; periksa PDF sumber.")
                _write_visible_text(replacement, spans)
                pages.append(index + 1)
                if not _meaningful(" ".join(span["text"] for span in spans)):
                    warnings.append(f"Halaman {index + 1}: OCR tidak menemukan teks yang cukup jelas; periksa halaman sumber.")
                del pixmap
            normalized.set_metadata(original.metadata)
            normalized.save(destination, garbage=4, deflate=True)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    if pages:
        warnings.append("OCR berjalan lokal. Periksa ejaan, angka, urutan kolom, tabel, dan gambar sebelum memakai hasil.")
    return {"pages": pages, "warnings": warnings}
