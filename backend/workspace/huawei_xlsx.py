"""Small, bounded read-only OOXML reader for the supported LLD layout."""
from dataclasses import dataclass
from io import BytesIO
from pathlib import PurePosixPath
import posixpath
import re
from xml.etree import ElementTree as ET
from zipfile import BadZipFile, ZipFile

MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE = "http://schemas.openxmlformats.org/package/2006/relationships"
MAX_UPLOAD = 10 * 1024 * 1024
MAX_EXPANDED = 40 * 1024 * 1024
MAX_CELLS = 120_000
MAX_ROWS = 20_000
MAX_COLS = 128


def coordinate(ref: str) -> tuple[int, int]:
    match = re.fullmatch(r"([A-Z]{1,3})([1-9][0-9]*)", ref or "")
    if not match:
        raise ValueError("Koordinat sel XLSX tidak valid.")
    col = 0
    for character in match[1]:
        col = col * 26 + ord(character) - 64
    row = int(match[2])
    if col > MAX_COLS or row > MAX_ROWS:
        raise ValueError("LLD melebihi batas 20.000 baris / 128 kolom per sheet.")
    return row, col


@dataclass
class Sheet:
    name: str
    cells: dict[tuple[int, int], str]

    def value(self, row: int, column: int) -> str:
        return self.cells.get((row, column), "").strip()

    def rows(self):
        grouped = {}
        for (row, column), value in self.cells.items():
            grouped.setdefault(row, {})[column] = value
        for row in sorted(grouped):
            yield row, grouped[row]


def read_xlsx(data: bytes) -> list[Sheet]:
    if not data or len(data) > MAX_UPLOAD:
        raise ValueError("Ukuran LLD harus 1 byte hingga 10 MB.")
    try:
        archive = ZipFile(BytesIO(data))
    except (BadZipFile, OSError) as exc:
        raise ValueError("Berkas bukan XLSX yang valid atau terenkripsi.") from exc
    with archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        if len(entries) > 1500 or len(set(names)) != len(names):
            raise ValueError("Struktur arsip XLSX tidak valid atau terlalu besar.")
        if sum(entry.file_size for entry in entries) > MAX_EXPANDED:
            raise ValueError("Isi XLSX setelah dibuka melebihi 40 MB.")
        for entry in entries:
            path = PurePosixPath(entry.filename)
            if entry.flag_bits & 1 or path.is_absolute() or ".." in path.parts or "\\" in entry.filename:
                raise ValueError("XLSX terenkripsi atau memiliki path yang tidak valid.")
            if entry.file_size > 16 * 1024 * 1024:
                raise ValueError("Bagian XLSX terlalu besar.")
            if "externalLinks/" in entry.filename or entry.filename.endswith("vbaProject.bin"):
                raise ValueError("Macro dan external workbook link tidak didukung.")

        def xml(name: str):
            try:
                raw = archive.read(name)
                # Reject entities before ElementTree sees the document. OOXML does not need them.
                if re.search(br"<!\s*(?:DOCTYPE|ENTITY)", raw, re.I):
                    raise ValueError("DTD/entity XML tidak didukung.")
                return ET.fromstring(raw)
            except (KeyError, ET.ParseError, BadZipFile, RuntimeError, OSError) as exc:
                raise ValueError(f"Bagian XLSX rusak: {name}.") from exc

        for name in names:
            if name.endswith(".rels"):
                if any(item.get("TargetMode") == "External" for item in xml(name)):
                    raise ValueError("Relationship eksternal XLSX tidak didukung.")
        workbook = xml("xl/workbook.xml")
        relations = {r.get("Id"): r.get("Target", "") for r in xml("xl/_rels/workbook.xml.rels")}
        shared = []
        if "xl/sharedStrings.xml" in names:
            shared = ["".join(item.itertext()) for item in xml("xl/sharedStrings.xml").findall(f"{{{MAIN}}}si")]
        sheets = []
        total_cells = 0
        for definition in workbook.findall(f"{{{MAIN}}}sheets/{{{MAIN}}}sheet"):
            name = definition.get("name", "")
            target = relations.get(definition.get(f"{{{REL}}}id"), "")
            if not target:
                raise ValueError("Relationship worksheet XLSX hilang.")
            target = posixpath.normpath(target.lstrip("/") if target.startswith("/") else posixpath.join("xl", target))
            if not target.startswith("xl/worksheets/"):
                raise ValueError("Target worksheet XLSX tidak didukung.")
            root = xml(target)
            cells = {}
            for cell in root.findall(f"{{{MAIN}}}sheetData/{{{MAIN}}}row/{{{MAIN}}}c"):
                key = coordinate(cell.get("r", ""))
                if key in cells:
                    raise ValueError(f"Sel duplikat pada sheet {name}.")
                value = cell.find(f"{{{MAIN}}}v")
                formula = cell.find(f"{{{MAIN}}}f")
                if formula is not None and (value is None or value.text is None):
                    raise ValueError(f"{name}!{cell.get('r')}: formula tidak memiliki cached value. Hitung ulang dan simpan di Excel.")
                kind = cell.get("t", "")
                if kind == "e":
                    raise ValueError(f"{name}!{cell.get('r')}: sel mengandung error Excel.")
                text = value.text if value is not None and value.text is not None else ""
                if kind == "s":
                    try:
                        index = int(text)
                        if index < 0:
                            raise ValueError()
                        text = shared[index]
                    except (IndexError, ValueError) as exc:
                        raise ValueError("Indeks shared string XLSX tidak valid.") from exc
                elif kind == "inlineStr":
                    text = "".join(cell.find(f"{{{MAIN}}}is").itertext()) if cell.find(f"{{{MAIN}}}is") is not None else ""
                if len(text) > 32_767:
                    raise ValueError("Isi satu sel XLSX terlalu panjang.")
                cells[key] = text
                total_cells += 1
                if total_cells > MAX_CELLS:
                    raise ValueError("LLD melebihi batas 120.000 sel.")
            for merge in root.findall(f"{{{MAIN}}}mergeCells/{{{MAIN}}}mergeCell"):
                try:
                    first, last = merge.get("ref", "").split(":")
                except ValueError as exc:
                    raise ValueError("Merged range XLSX tidak valid.") from exc
                r1, c1 = coordinate(first)
                r2, c2 = coordinate(last)
                count = (r2 - r1 + 1) * (c2 - c1 + 1)
                if r2 < r1 or c2 < c1 or count > MAX_CELLS or total_cells + count > MAX_CELLS:
                    raise ValueError("Merged range XLSX terlalu besar atau tidak valid.")
                value = cells.get((r1, c1), "")
                for row in range(r1, r2 + 1):
                    for column in range(c1, c2 + 1):
                        if not cells.get((row, column)):
                            if (row, column) not in cells:
                                total_cells += 1
                            cells[(row, column)] = value
            sheets.append(Sheet(name, cells))
        if len(sheets) != len({sheet.name for sheet in sheets}):
            raise ValueError("Nama sheet XLSX duplikat.")
        return sheets
