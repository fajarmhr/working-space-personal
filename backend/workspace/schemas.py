from datetime import datetime
from typing import Literal

from ninja import Schema
from pydantic import ConfigDict, Field


class ToolOut(Schema):
    id: str
    title: str
    description: str
    category: Literal["developer", "writing", "productivity", "security", "files"]
    execution: Literal["browser", "hybrid"]
    favorite: bool


class PreferencesOut(Schema):
    theme: Literal["light", "dark", "system"]
    display_name: str
    focus_minutes: int
    break_minutes: int
    huawei_enabled: bool
    active_workspace: Literal["personal", "huawei"]


class InputSchema(Schema):
    model_config = ConfigDict(extra="forbid")


class PreferencesPatch(InputSchema):
    theme: Literal["light", "dark", "system"] | None = None
    display_name: str | None = Field(default=None, max_length=60)
    focus_minutes: int | None = Field(default=None, ge=1, le=180, strict=True)
    break_minutes: int | None = Field(default=None, ge=1, le=60, strict=True)
    huawei_enabled: bool | None = Field(default=None, strict=True)
    active_workspace: Literal["personal", "huawei"] | None = None


class NoteOut(Schema):
    content: str
    updated_at: datetime | None


class NoteIn(InputSchema):
    content: str = Field(max_length=100_000)


class FavoriteIn(InputSchema):
    favorite: bool = Field(strict=True)


class FavoriteOut(Schema):
    tool_id: str
    favorite: bool


class ActivityIn(InputSchema):
    tool_id: str = Field(min_length=1, max_length=60)
    action: str = Field(min_length=1, max_length=160)


class ActivityOut(Schema):
    id: int
    tool_id: str
    action: str
    created_at: datetime


class BootstrapOut(Schema):
    tools: list[ToolOut]
    preferences: PreferencesOut
    note: NoteOut
    recent: list[ActivityOut]
    csrf_token: str


class DeletedOut(Schema):
    deleted: int


class HealthOut(Schema):
    status: Literal["ok"]
    version: str

