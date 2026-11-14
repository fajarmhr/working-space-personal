"""Multipart PDF input and opaque-ID job downloads, served only on loopback."""
from typing import Literal

from django.http import FileResponse
from ninja import File, Form, Router, Schema
from ninja.files import UploadedFile

from workspace import pdf_conversion as service


router = Router(tags=["PDF to DOCX"])


class PdfJobOut(Schema):
    id: str
    state: Literal["queued", "running", "completed", "failed"]
    stage: Literal["queued", "validating", "converting", "verifying", "completed", "failed"]
    mode: Literal["editable"]
    filename: str
    created_at: str
    updated_at: str
    page_count: int | None
    progress: int | None
    message: str
    warnings: list[str]
    error: str | None
    download_url: str | None


@router.post("/convert", response={202: PdfJobOut})
def convert_pdf(request, file: File[UploadedFile], mode: Form[Literal["editable"]] = "editable"):
    return 202, service.create_job(file, mode)


@router.get("/jobs/{job_id}", response=PdfJobOut)
def job_status(request, job_id: str):
    return service.get_job(job_id)


@router.get("/download/{job_id}")
def download_docx(request, job_id: str):
    path, filename = service.completed_result(job_id)
    return FileResponse(
        path.open("rb"), as_attachment=True, filename=filename,
        content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
