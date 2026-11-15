"""Local-only screenshot sessions protected by the shared CSRF middleware."""
from typing import Literal
from uuid import UUID

from django.http import FileResponse
from ninja import Router, Schema
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
