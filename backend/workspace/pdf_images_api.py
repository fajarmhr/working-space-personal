"""Local multipart image inputs and opaque-ID image/export downloads."""
from typing import Literal

from django.http import FileResponse
from ninja import File, Form, Router, Schema
from ninja.files import UploadedFile
from pydantic import Field

from workspace import pdf_images as service
from workspace.schemas import InputSchema

router = Router(tags=["PDF to images"])


class PdfImageAssetOut(Schema):
    id: str
    job_id: str
    name: str
    width: int
    height: int
    dpi: int
    image_url: str
    thumbnail_url: str
    source_page: int | None
    size: int


class PdfImageJobOut(Schema):
    id: str
    kind: Literal["import", "export"]
    state: Literal["queued", "running", "completed", "failed"]
    filename: str
    progress: int | None
    message: str
    error: str | None
    pages: list[PdfImageAssetOut]
    download_url: str | None


class PageReference(InputSchema):
    job_id: str = Field(max_length=36)
    id: str = Field(max_length=36)


class ExportImagesIn(InputSchema):
    pages: list[PageReference] = Field(min_length=1, max_length=100)
    format: Literal["png", "jpeg", "webp", "tiff"] = "png"
    quality: int = Field(default=95, ge=1, le=100, strict=True)
    bundle: bool = Field(default=True, strict=True)
    webp_lossless: bool = Field(default=False, strict=True)


@router.post("/import", response={202: PdfImageJobOut})
def import_pdf(request, file: File[UploadedFile], dpi: Form[int] = 300):
    return 202, service.create_import(file, dpi)


@router.post("/assets", response=PdfImageAssetOut)
def add_image(request, file: File[UploadedFile], dpi: Form[int] = 300):
    return service.add_asset(file, dpi)


@router.get("/jobs/{job_id}", response=PdfImageJobOut)
def job(request, job_id: str):
    return service.get_job(job_id)


@router.get("/assets/{job_id}/{asset_id}")
def image(request, job_id: str, asset_id: str):
    path, _ = service.asset_path(job_id, asset_id)
    return FileResponse(path.open("rb"), content_type="image/png")


@router.get("/thumbnail/{job_id}/{asset_id}")
def thumbnail(request, job_id: str, asset_id: str):
    path, _ = service.asset_path(job_id, asset_id, thumbnail=True)
    return FileResponse(path.open("rb"), content_type="image/png")


@router.post("/export", response={202: PdfImageJobOut})
def export(request, payload: ExportImagesIn):
    return 202, service.create_export([page.model_dump() for page in payload.pages], payload.format, payload.quality, payload.bundle, payload.webp_lossless)


@router.get("/download/{job_id}")
def download(request, job_id: str):
    path, filename, mime = service.completed_result(job_id)
    return FileResponse(path.open("rb"), as_attachment=True, filename=filename, content_type=mime)
