"""Typed input and output contracts for local tasks and reusable plain text."""
import re
from datetime import date, datetime
from typing import Literal

from ninja import Schema
from pydantic import Field, field_validator

from workspace.schemas import InputSchema


def _trimmed_nonempty(value):
    if isinstance(value, str):
        value = value.strip()
        if not value:
            raise ValueError("Isian tidak boleh hanya berisi spasi.")
    return value


def _iso_date(value):
    if value is None:
        return None
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        raise ValueError("Tanggal harus menggunakan format YYYY-MM-DD.")
    return date.fromisoformat(value)


class TaskCreate(InputSchema):
    title: str = Field(min_length=1, max_length=180)
    details: str = Field(default="", max_length=4000)
    priority: Literal["low", "normal", "high"] = "normal"
    due_date: date | None = None

    _title = field_validator("title", mode="before")(_trimmed_nonempty)
    _due_date = field_validator("due_date", mode="before")(_iso_date)


class TaskPatch(InputSchema):
    title: str | None = Field(default=None, min_length=1, max_length=180)
    details: str | None = Field(default=None, max_length=4000)
    priority: Literal["low", "normal", "high"] | None = None
    due_date: date | None = None
    completed: bool | None = Field(default=None, strict=True)

    _title = field_validator("title", mode="before")(_trimmed_nonempty)
    _due_date = field_validator("due_date", mode="before")(_iso_date)


class TaskOut(Schema):
    id: int
    title: str
    details: str
    priority: Literal["low", "normal", "high"]
    due_date: date | None
    completed: bool
    created_at: datetime
    updated_at: datetime


class TaskList(Schema):
    items: list[TaskOut]


class SnippetCreate(InputSchema):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=20000)
    category: str = Field(default="Umum", min_length=1, max_length=40)

    _labels = field_validator("title", "category", mode="before")(_trimmed_nonempty)

    @field_validator("content")
    @classmethod
    def content_is_not_blank(cls, value):
        if not value.strip():
            raise ValueError("Isi snippet tidak boleh kosong.")
        return value


class SnippetPatch(InputSchema):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    content: str | None = Field(default=None, min_length=1, max_length=20000)
    category: str | None = Field(default=None, min_length=1, max_length=40)

    _labels = field_validator("title", "category", mode="before")(_trimmed_nonempty)

    @field_validator("content")
    @classmethod
    def content_is_not_blank(cls, value):
        if value is not None and not value.strip():
            raise ValueError("Isi snippet tidak boleh kosong.")
        return value


class SnippetOut(Schema):
    id: int
    title: str
    content: str
    category: str
    created_at: datetime
    updated_at: datetime


class SnippetList(Schema):
    items: list[SnippetOut]
