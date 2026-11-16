"""Persistable draft metadata. Credentials and activation are deliberately absent."""
from datetime import datetime
from string import Formatter
from typing import Literal
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

IDENTIFIER = r"^[A-Za-z0-9_-]{1,60}$"
SECRET_REFERENCE = r"^(?:|[A-Z][A-Z0-9_]{2,79})$"
TEMPLATE_FIELDS = {"report_name", "window_start", "window_end", "summary"}


class DraftModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


def valid_timezone(value: str) -> str:
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as error:
        raise ValueError("Gunakan zona waktu IANA yang tersedia, misalnya Asia/Makassar.") from error
    return value


def valid_template(value: str) -> str:
    try:
        fields = list(Formatter().parse(value))
    except ValueError as error:
        raise ValueError("Format template tidak valid.") from error
    for _, field, format_spec, conversion in fields:
        if field is not None and (field not in TEMPLATE_FIELDS or format_spec or conversion):
            raise ValueError("Template hanya menerima report_name, window_start, window_end, dan summary tanpa format/conversion.")
    return value


class SourceDraft(DraftModel):
    base_url: str = Field(default="", max_length=2048)
    page_path: str = Field(default="", max_length=2048)
    browser_profile_id: str = Field(default="u2020-personal", pattern=IDENTIFIER)
    export_format: Literal["csv", "xlsx"] = "csv"
    selectors_confirmed: bool = Field(default=False, strict=True)

    @field_validator("base_url")
    @classmethod
    def base_url_is_origin(cls, value):
        if not value:
            return value
        try:
            parsed = urlsplit(value)
            if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
                raise ValueError()
            parsed.port
        except ValueError as error:
            raise ValueError("Base URL harus HTTP(S), tanpa kredensial, query, atau fragment.") from error
        return value.rstrip("/")

    @field_validator("page_path")
    @classmethod
    def page_is_relative(cls, value):
        if value:
            parsed = urlsplit(value)
            if not value.startswith("/") or value.startswith("//") or parsed.scheme or parsed.netloc or "\\" in value or any(ord(c) < 32 for c in value):
                raise ValueError("Halaman U2020 harus path relatif yang dimulai /.")
        return value


class MetricDraft(DraftModel):
    key: str = Field(pattern=IDENTIFIER)
    label: str = Field(min_length=1, max_length=120)
    column: str = Field(min_length=1, max_length=120)
    unit: str = Field(default="", max_length=30)


class DatasetDraft(DraftModel):
    timestamp_column: str = Field(default="", max_length=120)
    entity_column: str = Field(default="", max_length=120)
    timezone: str = "Asia/Makassar"
    metrics: list[MetricDraft] = Field(default_factory=list, max_length=100)

    _timezone = field_validator("timezone")(valid_timezone)

    @model_validator(mode="after")
    def unique_metrics(self):
        if len({metric.key for metric in self.metrics}) != len(self.metrics):
            raise ValueError("Key KPI tidak boleh berulang.")
        if len({metric.column for metric in self.metrics}) != len(self.metrics):
            raise ValueError("Kolom KPI tidak boleh dipetakan lebih dari sekali.")
        return self


class ScheduleDraft(DraftModel):
    timezone: str = "Asia/Makassar"
    interval_minutes: int = Field(default=60, ge=1, le=10080, strict=True)
    lookback_minutes: int = Field(default=60, ge=1, le=43200, strict=True)
    delay_minutes: int = Field(default=10, ge=0, le=1440, strict=True)
    start_at: datetime | None = None
    end_at: datetime | None = None

    _timezone = field_validator("timezone")(valid_timezone)

    @field_validator("start_at", "end_at", mode="before")
    @classmethod
    def offset_required(cls, value):
        if value is None:
            return None
        if isinstance(value, str):
            try:
                value = datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError as error:
                raise ValueError("Waktu harus ISO 8601 dengan offset.") from error
        if not isinstance(value, datetime) or value.utcoffset() is None:
            raise ValueError("Waktu harus ISO 8601 dengan offset.")
        return value

    @model_validator(mode="after")
    def date_order(self):
        if self.start_at is not None and self.end_at is not None and self.end_at <= self.start_at:
            raise ValueError("Akhir monitoring harus sesudah awal monitoring.")
        return self


class EmailDraft(DraftModel):
    enabled: bool = Field(default=False, strict=True)
    to: list[str] = Field(default_factory=list, max_length=20)
    subject_template: str = Field(default="{report_name} — {window_end}", max_length=200)
    body_template: str = Field(default="Periode {window_start} sampai {window_end}.\n{summary}", max_length=10000)
    smtp_secret_ref: str = Field(default="", pattern=SECRET_REFERENCE)

    @field_validator("to")
    @classmethod
    def recipients(cls, values):
        for value in values:
            if len(value) > 254 or value.count("@") != 1 or any(c.isspace() for c in value) or any(c in value for c in "<>,;\r\n") or value.startswith("@") or value.endswith("@"):
                raise ValueError("Alamat penerima email tidak valid.")
        if len({value.casefold() for value in values}) != len(values):
            raise ValueError("Penerima email tidak boleh berulang.")
        return values

    @field_validator("subject_template")
    @classmethod
    def subject_is_single_line(cls, value):
        if "\r" in value or "\n" in value:
            raise ValueError("Subject email tidak boleh berisi baris baru.")
        return valid_template(value)

    _body = field_validator("body_template")(valid_template)


class TelegramDraft(DraftModel):
    enabled: bool = Field(default=False, strict=True)
    chat_id: str = Field(default="", max_length=30, pattern=r"^(?:|-?[0-9]+)$")
    bot_token_secret_ref: str = Field(default="", pattern=SECRET_REFERENCE)
    caption_template: str = Field(default="{report_name}\n{window_start} – {window_end}\n{summary}", max_length=1024)

    _caption = field_validator("caption_template")(valid_template)


class DeliveryProfileDraft(DraftModel):
    id: str = Field(default="personal", pattern=IDENTIFIER)
    label: str = Field(default="Personal", max_length=120)
    email: EmailDraft = Field(default_factory=EmailDraft)
    telegram: TelegramDraft = Field(default_factory=TelegramDraft)


class ReportingDraft(DraftModel):
    enabled: Literal[False] = False
    name: str = Field(default="UPF KPI Monitoring", min_length=1, max_length=120)
    profile_id: str = Field(default="personal", pattern=IDENTIFIER)
    source: SourceDraft = Field(default_factory=SourceDraft)
    dataset: DatasetDraft = Field(default_factory=DatasetDraft)
    schedule: ScheduleDraft = Field(default_factory=ScheduleDraft)
    delivery_profiles: list[DeliveryProfileDraft] = Field(default_factory=lambda: [DeliveryProfileDraft()], max_length=20)

    @field_validator("enabled", mode="before")
    @classmethod
    def cannot_enable(cls, value):
        if value is not False:
            raise ValueError("Reporting masih kerangka; aktivasi dan pengiriman belum tersedia.")
        return False

    @model_validator(mode="after")
    def unique_profiles(self):
        if len({profile.id for profile in self.delivery_profiles}) != len(self.delivery_profiles):
            raise ValueError("ID profil pengiriman tidak boleh berulang.")
        return self


def default_draft() -> dict:
    return ReportingDraft().model_dump(mode="json")
