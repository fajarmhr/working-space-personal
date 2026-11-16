"""Ports for later integrations. No adapter performs network or device actions."""
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Protocol, Sequence

from .config import ReportingDraft
from .planner import ReportWindow


class ReportingNotConfigured(RuntimeError):
    """A required live integration has not been implemented and verified."""


@dataclass(frozen=True)
class ExportArtifact:
    path: Path
    format: str
    collected_at: datetime
    source_window: ReportWindow


@dataclass(frozen=True)
class ChartArtifact:
    path: Path
    media_type: str
    window: ReportWindow
    summary: str


@dataclass(frozen=True)
class DeliveryReceipt:
    channel: str
    provider_message_id: str
    accepted_at: datetime


class KpiSource(Protocol):
    def fetch(self, config: ReportingDraft, window: ReportWindow) -> ExportArtifact: ...


class ChartRenderer(Protocol):
    def render(self, dataset, window: ReportWindow, output_directory: Path) -> Sequence[ChartArtifact]: ...


class SecretResolver(Protocol):
    def resolve(self, reference: str) -> str: ...


class DeliveryChannel(Protocol):
    def send(self, chart: ChartArtifact, profile, idempotency_key: str) -> DeliveryReceipt: ...


class ReportingStateStore(Protocol):
    """Later SQLite implementation must use unique run/channel keys and atomic leases.

    A timed-out/expired sending lease becomes unknown, never automatically pending.
    Sent email and pending Telegram are independent; retry only the failed channel.
    """

    def acquire_run(self, run_key: str, lease_until: datetime) -> bool: ...
    def delivery_state(self, key: str) -> str: ...
    def claim_delivery(self, key: str, lease_until: datetime) -> bool: ...
    def mark_sent(self, key: str, receipt: DeliveryReceipt) -> None: ...
    def mark_failed(self, key: str, reason_code: str, retry_at: datetime) -> None: ...
    def mark_unknown(self, key: str, reason_code: str) -> None: ...


class U2020BrowserSource:
    def fetch(self, config: ReportingDraft, window: ReportWindow) -> ExportArtifact:
        raise ReportingNotConfigured("U2020: login/profile, halaman, filter, dan export selector belum diverifikasi pada target.")


class PngChartRenderer:
    def render(self, dataset, window: ReportWindow, output_directory: Path) -> Sequence[ChartArtifact]:
        raise ReportingNotConfigured("Renderer PNG dan template graph belum dipilih berdasarkan contoh KPI.")


class SmtpEmailChannel:
    def send(self, chart: ChartArtifact, profile, idempotency_key: str) -> DeliveryReceipt:
        raise ReportingNotConfigured("SMTP/TLS, From, penerima, secret resolver, dan template email belum dikonfigurasi.")


class TelegramPhotoChannel:
    def send(self, chart: ChartArtifact, profile, idempotency_key: str) -> DeliveryReceipt:
        raise ReportingNotConfigured("Bot/chat pribadi, secret resolver, dan template caption Telegram belum dikonfigurasi.")


class ReportingRunner:
    def __init__(self, source: KpiSource, renderer: ChartRenderer, channels: Sequence[DeliveryChannel], state_store: ReportingStateStore):
        self.source, self.renderer = source, renderer
        self.channels, self.state_store = channels, state_store

    def run(self, config: ReportingDraft, window: ReportWindow):
        # Keep this guard before all injected collaborators, including test doubles.
        raise ReportingNotConfigured("Reporting masih kerangka nonaktif. Worker, adapter, dan penerimaan lingkungan target belum selesai.")
