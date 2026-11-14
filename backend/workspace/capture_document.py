"""Deterministic screenshot report generation, separate from any screen APIs."""
from __future__ import annotations

import os
from pathlib import Path
from uuid import uuid4


MAX_CAPTURE_COUNT = 200
MAX_CAPTURE_PIXELS = 40_000_000
MAX_SESSION_BYTES = 256 * 1024 * 1024


def write_capture_document(frames: list[tuple[Path, str]], output: Path) -> None:
    """Rebuild then atomically replace the report; the last valid DOCX survives failure."""
    from docx import Document
    from docx.enum.section import WD_ORIENT
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Mm, Pt
    from PIL import Image

    if not frames or len(frames) > MAX_CAPTURE_COUNT:
        raise ValueError("Jumlah screenshot harus antara 1 dan 200.")
    document = Document()
    document.core_properties.title = "Screenshot sesi Ruang"
    document.core_properties.subject = "Laporan screenshot yang dibuat atas permintaan pengguna"
    section = document.sections[0]
    section.orientation = WD_ORIENT.LANDSCAPE
    section.page_width, section.page_height = Mm(297), Mm(210)
    section.left_margin = section.right_margin = Mm(12)
    section.top_margin = section.bottom_margin = Mm(12)
    normal = document.styles["Normal"]
    normal.font.name = "Arial"
    normal.font.size = Pt(9)
    normal.paragraph_format.space_before = Pt(0)
    normal.paragraph_format.space_after = Pt(0)
    normal.paragraph_format.line_spacing = 1
    available_width = int(section.page_width - section.left_margin - section.right_margin)
    available_height = int(section.page_height - section.top_margin - section.bottom_margin - Mm(15))
    for index, (image_path, timestamp) in enumerate(frames, start=1):
        if index > 1:
            document.add_page_break()
        with Image.open(image_path) as image:
            width, height = image.size
        if width < 1 or height < 1 or width * height > MAX_CAPTURE_PIXELS:
            raise ValueError("Dimensi screenshot tidak didukung.")
        scale = min(available_width / width, available_height / height)
        paragraph = document.add_paragraph()
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        paragraph.add_run().add_picture(
            str(image_path), width=int(width * scale), height=int(height * scale)
        )
        caption = document.add_paragraph(f"Screenshot {index} | {timestamp}")
        caption.alignment = WD_ALIGN_PARAGRAPH.CENTER
        caption.paragraph_format.space_before = Pt(5)
    temporary = output.with_name(f".{output.stem}.{uuid4().hex}.tmp.docx")
    try:
        document.save(temporary)
        with temporary.open("r+b") as saved:
            os.fsync(saved.fileno())
        os.replace(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)
