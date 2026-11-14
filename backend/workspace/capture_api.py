"""Local-only native sessions. Every start/take/stop route requires existing CSRF middleware."""
from typing import Literal
from uuid import UUID

from django.http import FileResponse
from ninja import Router, Schema
from pydantic import Field, field_validator

from workspace.capture_keyboard import applications, keyboard_service
from workspace.capture_service import capture_service
from workspace.schemas import InputSchema


router = Router(tags=["Native sessions"])
State = Literal["idle", "starting", "active", "stopping", "stopped", "error"]


class CaptureStart(InputSchema):
    hotkey: Literal["ctrl+shift+s", "ctrl+alt+s"] = "ctrl+shift+s"


class CaptureStatus(Schema):
    supported: bool
    state: State
    session_id: str | None
    hotkey: str
    capture_count: int
    last_capture_at: str | None
    error: str | None
    download_url: str | None
    busy: bool = False


class KeyboardStart(InputSchema):
    applications: list[str] = Field(min_length=1, max_length=7)

    @field_validator("applications")
    @classmethod
    def supported_applications(cls, values):
        from workspace.capture_common import KEYBOARD_APPLICATIONS
        normalized = [value.lower() for value in values]
        if any(value not in KEYBOARD_APPLICATIONS for value in normalized):
            raise ValueError("Pilih aplikasi dari daftar yang didukung.")
        return list(dict.fromkeys(normalized))


class KeyboardStatus(Schema):
    supported: bool
    state: State
    session_id: str | None
    applications: list[str]
    line_count: int
    last_recorded_at: str | None
    error: str | None
    download_url: str | None


@router.get("/status", response=CaptureStatus)
def capture_status(request):
    return capture_service.status()


@router.post("/start", response=CaptureStatus)
def capture_start(request, payload: CaptureStart):
    return capture_service.start(payload.hotkey)


@router.post("/take", response=CaptureStatus)
def capture_take(request):
    return capture_service.take()


@router.post("/stop", response=CaptureStatus)
def capture_stop(request):
    return capture_service.stop()


@router.get("/sessions")
def capture_sessions(request):
    return capture_service.sessions()


@router.get("/download/{identifier}")
def capture_download(request, identifier: UUID):
    path = capture_service.download_path(str(identifier))
    return FileResponse(path.open("rb"), as_attachment=True, filename=f"ruang-screenshot-{identifier}.docx", content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")


@router.get("/keyboard/apps")
def keyboard_applications(request):
    return applications()


@router.get("/keyboard/status", response=KeyboardStatus)
def keyboard_status(request):
    return keyboard_service.status()


@router.post("/keyboard/start", response=KeyboardStatus)
def keyboard_start(request, payload: KeyboardStart):
    return keyboard_service.start(payload.applications)


@router.post("/keyboard/stop", response=KeyboardStatus)
def keyboard_stop(request):
    return keyboard_service.stop()


@router.get("/keyboard/sessions")
def keyboard_sessions(request):
    return keyboard_service.sessions()


@router.get("/keyboard/download/{identifier}")
def keyboard_download(request, identifier: UUID):
    path = keyboard_service.download_path(str(identifier))
    return FileResponse(path.open("rb"), as_attachment=True, filename=f"ruang-input-{identifier}.txt", content_type="text/plain; charset=utf-8")
