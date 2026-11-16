"""Pure schedule/readiness planning. Nothing here starts a scheduler or sends data."""
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from hashlib import sha256
import json
from typing import Literal

from .config import ReportingDraft, ScheduleDraft


@dataclass(frozen=True)
class ReportWindow:
    start: datetime
    end: datetime
    slot: str


def report_window(schedule: ScheduleDraft, now: datetime) -> ReportWindow | None:
    if now.utcoffset() is None:
        raise ValueError("Waktu scheduler harus memiliki offset.")
    current = now.astimezone(UTC)
    start = schedule.start_at.astimezone(UTC) if schedule.start_at else datetime(1970, 1, 1, tzinfo=UTC)
    if current < start or (schedule.end_at and current >= schedule.end_at.astimezone(UTC)):
        return None
    # Fixed UTC cadence; timezone is for display and operator-entered boundaries.
    # Delay keeps the last report window away from incomplete U2020 export data.
    available = current - timedelta(minutes=schedule.delay_minutes)
    interval = timedelta(minutes=schedule.interval_minutes)
    index = (available - start) // interval
    if index < 1:
        return None
    end = start + index * interval
    return ReportWindow(end - timedelta(minutes=schedule.lookback_minutes), end, end.isoformat())


def delivery_key(report_id: str, profile_id: str, slot: str, channel: Literal["email", "telegram"]) -> str:
    if channel not in ("email", "telegram"):
        raise ValueError("Channel reporting tidak didukung.")
    raw = json.dumps([report_id, profile_id, slot, channel], separators=(",", ":"))
    return sha256(raw.encode()).hexdigest()


def retry_delay(attempt: int, base_seconds: int = 30, ceiling_seconds: int = 900) -> int:
    if isinstance(attempt, bool) or not isinstance(attempt, int) or not 1 <= attempt <= 20:
        raise ValueError("Attempt harus 1–20.")
    return min(ceiling_seconds, base_seconds * 2 ** (attempt - 1))


def delivery_action(state: str, attempts: int, max_attempts: int = 3) -> str:
    if state == "sent":
        return "skip"
    if state == "unknown":
        return "review"  # Provider may have accepted a timed-out send; never retry blindly.
    if state == "sending":
        return "locked"
    if state not in ("pending", "failed"):
        raise ValueError("State delivery tidak valid.")
    return "retry" if attempts < max_attempts else "exhausted"


def analyze_draft(draft: ReportingDraft | dict, now: datetime | None = None) -> dict:
    config = draft if isinstance(draft, ReportingDraft) else ReportingDraft.model_validate(draft)
    missing = []

    def need(condition, code, message):
        if condition:
            missing.append({"code": code, "message": message})

    need(not config.source.base_url, "source_url", "URL/versi U2020, akses jaringan/VPN, dan cara login belum ditentukan.")
    need(not config.source.page_path or not config.source.selectors_confirmed, "u2020_pages", "Halaman KPI, filter NE, rentang waktu, dan langkah ekspor U2020 belum diverifikasi.")
    need(not config.dataset.timestamp_column or not config.dataset.entity_column or not config.dataset.metrics, "kpi_mapping", "Contoh CSV/XLSX, kolom waktu/NE/KPI, unit, agregasi, dan granularity diperlukan.")
    need(config.source.export_format == "xlsx", "xlsx_adapter", "Adapter XLSX reporting belum diterapkan; format sheet/header perlu contoh ekspor.")
    need(config.schedule.start_at is None or config.schedule.end_at is None, "monitoring_period", "Tanggal mulai/akhir monitoring dan interval final belum lengkap.")
    selected = next((profile for profile in config.delivery_profiles if profile.id == config.profile_id), None)
    need(selected is None, "delivery_profile", "Pilih profil pengiriman yang tersedia.")
    if selected:
        need(not selected.email.enabled and not selected.telegram.enabled, "delivery_channel", "Pilih kanal email dan/atau Telegram pada profil penerima.")
        need(selected.email.enabled and (not selected.email.to or not selected.email.smtp_secret_ref), "email_setup", "Email memerlukan penerima, konfigurasi SMTP/TLS/From, secret reference, serta template final.")
        need(selected.telegram.enabled and (not selected.telegram.chat_id or not selected.telegram.bot_token_secret_ref), "telegram_setup", "Telegram memerlukan bot pribadi, /start, chat ID, dan secret reference profil tersebut.")
    missing.extend([
        {"code": "chart_template", "message": "Layout graph, jumlah panel, threshold, judul, unit, dan ukuran PNG perlu disepakati."},
        {"code": "retention_and_failure", "message": "Retensi data, stale-data rule, retry, missed-run policy, dan tujuan notifikasi kegagalan perlu ditentukan."},
        {"code": "runtime_host", "message": "Host monitoring harus menyala, tidak sleep, tersambung U2020/VPN, email, dan Telegram selama periode monitoring."},
        {"code": "adapter_validation", "message": "Connector U2020, renderer PNG, SMTP, Telegram, scheduler, dan penyimpanan status belum dihubungkan atau diuji di lingkungan target."},
    ])
    components = [
        {"id": "u2020", "status": "not_configured", "message": "Kontrak browser/profile siap; login, selector, dan ekspor belum diimplementasikan."},
        {"id": "normalizer", "status": "scaffold", "message": "Pembaca CSV UTF-8 generik tersedia; mapping ekspor U2020 belum diverifikasi."},
        {"id": "chart", "status": "not_configured", "message": "Kontrak PNG siap; renderer dan template graph belum dipilih."},
        {"id": "delivery", "status": "not_configured", "message": "Kontrak email/Telegram per profil siap; tidak ada pengiriman jaringan."},
        {"id": "scheduler", "status": "scaffold", "message": "Planner slot/retry/idempotency tersedia; worker dan durable leases belum diaktifkan."},
    ]
    window = report_window(config.schedule, now or datetime.now(UTC))
    return {
        "active": False,
        "can_activate": False,
        "missing_requirements": missing,
        "components": components,
        "flow": [{"id": item["id"], "label": label, "status": item["status"]} for item, label in zip(components, ("Ambil ekspor U2020", "Normalisasi dan periksa KPI", "Render graph PNG", "Kirim email dan Telegram", "Jadwalkan dan catat status"))],
        "next_window": {"start": window.start.isoformat(), "end": window.end.isoformat(), "slot": window.slot} if window else None,
    }
