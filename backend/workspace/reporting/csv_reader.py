"""Local, explicit wide CSV normalization; it does not assume a U2020 layout."""
import csv
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from io import StringIO
from zoneinfo import ZoneInfo

from .config import DatasetDraft
from .contracts import ReportingNotConfigured
from .planner import ReportWindow

MAX_POINTS = 200_000
MAX_ISSUES = 1_000


class _BoundedIssues(list):
    def append(self, issue):
        if len(self) >= MAX_ISSUES:
            raise ValueError("CSV menghasilkan terlalu banyak masalah kualitas data (maksimal 1.000); perbaiki mapping/sumber terlebih dahulu.")
        super().append(issue)


@dataclass(frozen=True)
class KpiPoint:
    timestamp: datetime
    entity: str
    metric: str
    value: Decimal
    unit: str


@dataclass(frozen=True)
class DataIssue:
    code: str
    message: str
    row: int | None = None


@dataclass(frozen=True)
class NormalizedDataset:
    points: list[KpiPoint]
    issues: list[DataIssue]

    @property
    def can_chart(self) -> bool:
        return bool(self.points) and not self.issues


def _timestamp(value: str, zone: ZoneInfo) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.utcoffset() is None:
        first, second = parsed.replace(tzinfo=zone, fold=0), parsed.replace(tzinfo=zone, fold=1)
        if first.utcoffset() != second.utcoffset() or first.astimezone(UTC).astimezone(zone).replace(tzinfo=None) != parsed:
            raise ValueError("Waktu lokal ambigu/tidak ada; ekspor harus memberikan offset.")
        parsed = first
    return parsed.astimezone(UTC)


def _rows(reader):
    try:
        yield from reader
    except csv.Error as error:
        raise ValueError("Struktur kutipan/field CSV tidak valid.") from error


def normalize_csv(data: bytes, mapping: DatasetDraft, window: ReportWindow | None = None, *, now: datetime | None = None, max_age_minutes: int = 120, expected_interval_minutes: int | None = None) -> NormalizedDataset:
    if not mapping.timestamp_column or not mapping.entity_column or not mapping.metrics:
        raise ReportingNotConfigured("Mapping kolom waktu, NE, dan KPI harus dilengkapi.")
    if not data or len(data) > 10 * 1024 * 1024:
        raise ValueError("CSV harus 1 byte sampai 10 MB.")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ValueError("CSV harus UTF-8; encoding lain memerlukan adapter ekspor yang disepakati.") from error
    if "\x00" in text:
        raise ValueError("CSV tidak boleh mengandung data biner.")
    if max_age_minutes < 1 or (expected_interval_minutes is not None and expected_interval_minutes < 1):
        raise ValueError("Batas freshness/granularity harus positif.")
    current = now or datetime.now(UTC)
    if current.utcoffset() is None:
        raise ValueError("Waktu pemeriksaan harus mempunyai offset.")
    reader = csv.DictReader(StringIO(text), strict=True)
    try:
        headers = reader.fieldnames or []
    except csv.Error as error:
        raise ValueError("Header CSV tidak valid.") from error
    needed = {mapping.timestamp_column, mapping.entity_column, *(metric.column for metric in mapping.metrics)}
    if len(headers) > 128 or not all(headers) or len(set(headers)) != len(headers) or not needed <= set(headers):
        raise ValueError("Header CSV kosong/berulang atau kolom mapping tidak ditemukan; delimiter yang didukung saat ini koma.")
    zone = ZoneInfo(mapping.timezone)
    points, issues, seen = [], _BoundedIssues(), set()
    for index, row in enumerate(_rows(reader), 2):
        if index > 100001:
            raise ValueError("CSV melebihi batas 100.000 record.")
        if None in row or any(value is None for value in row.values()):
            raise ValueError(f"CSV baris {index}: jumlah kolom tidak sesuai header.")
        try:
            timestamp = _timestamp(row[mapping.timestamp_column].strip(), zone)
        except ValueError:
            issues.append(DataIssue("timestamp", "Waktu harus ISO 8601 dan tidak ambigu pada timezone sumber.", index))
            continue
        entity = row[mapping.entity_column].strip()
        if not entity:
            issues.append(DataIssue("entity", "Identitas NE kosong.", index))
            continue
        if window and not window.start <= timestamp < window.end:
            issues.append(DataIssue("outside_window", "Record berada di luar rentang laporan yang diminta.", index))
            continue
        if timestamp > current:
            issues.append(DataIssue("future", "Timestamp KPI berada di masa depan.", index))
            continue
        for metric in mapping.metrics:
            raw = row[metric.column].strip()
            try:
                value = Decimal(raw)
                if not value.is_finite():
                    raise InvalidOperation()
            except InvalidOperation:
                issues.append(DataIssue("missing_or_invalid_value", f"KPI {metric.key} kosong/non-numerik; tidak diubah menjadi nol.", index))
                continue
            key = timestamp, entity, metric.key
            if key in seen:
                issues.append(DataIssue("duplicate", f"KPI {metric.key} pada waktu/NE yang sama berulang.", index))
                continue
            if len(points) >= MAX_POINTS:
                raise ValueError("Kombinasi record dan KPI melebihi batas 200.000 titik; kurangi periode/NE/KPI ekspor.")
            seen.add(key)
            points.append(KpiPoint(timestamp, entity, metric.key, value, metric.unit))
    if not points:
        issues.append(DataIssue("empty", "Tidak ada titik KPI valid dalam ekspor."))
    else:
        latest = {}
        for point in points:
            key = point.entity, point.metric
            latest[key] = max(latest.get(key, point.timestamp), point.timestamp)
        for (entity, metric), timestamp in latest.items():
            if current - timestamp > timedelta(minutes=max_age_minutes):
                issues.append(DataIssue("stale", f"Data terakhir {entity}/{metric} melebihi batas freshness; jangan mengirimnya sebagai kondisi terkini."))
    if window and expected_interval_minutes:
        cadence = timedelta(minutes=expected_interval_minutes)
        grouped = {}
        for point in points:
            grouped.setdefault((point.entity, point.metric), set()).add(point.timestamp)
        for (entity, metric), times in grouped.items():
            ordered = sorted(times)
            if ordered[0] > window.start or ordered[-1] < window.end - cadence or any(right - left > cadence for left, right in zip(ordered, ordered[1:])):
                issues.append(DataIssue("coverage_gap", f"Rentang KPI {entity}/{metric} belum lengkap pada granularity yang ditentukan."))
    return NormalizedDataset(sorted(points, key=lambda point: (point.timestamp, point.entity, point.metric)), issues)


def normalize_xlsx(data: bytes, mapping: DatasetDraft, window: ReportWindow | None = None) -> NormalizedDataset:
    raise ReportingNotConfigured("Adapter XLSX reporting memerlukan contoh sheet/header ekspor U2020. Gunakan CSV setelah mapping disepakati.")
