"""Inactive reporting configuration only: no browser, scheduler or delivery runs."""
from django.db import transaction
from ninja import Router
from ninja.errors import HttpError
from pydantic import Field

from workspace import services
from workspace.models import HuaweiReportingDraft
from workspace.reporting import ReportingDraft, analyze_draft, default_draft
from workspace.schemas import InputSchema


router = Router(tags=["Huawei reporting draft"])


class SaveReportingDraft(InputSchema):
    config: ReportingDraft
    revision: int = Field(ge=0, strict=True)


def require_huawei():
    if not services.preferences().huawei_enabled:
        raise HttpError(403, "Aktifkan Huawei workspace di Pengaturan terlebih dahulu.")


def response_for(saved=None):
    config = ReportingDraft.model_validate(saved.config if saved else default_draft())
    return {
        "config": config.model_dump(mode="json"),
        "readiness": analyze_draft(config),
        "revision": saved.revision if saved else 0,
        "updated_at": saved.updated_at.isoformat() if saved else None,
    }


@router.get("/draft")
def reporting_draft(request):
    require_huawei()
    return response_for(HuaweiReportingDraft.objects.filter(pk=1).first())


@router.put("/draft")
@transaction.atomic
def save_reporting_draft(request, payload: SaveReportingDraft):
    require_huawei()
    current = HuaweiReportingDraft.objects.filter(pk=1).first()
    revision = current.revision if current else 0
    if revision != payload.revision:
        raise HttpError(409, "Draft berubah di tab lain. Muat ulang draft sebelum menyimpan lagi.")
    saved = current or HuaweiReportingDraft(pk=1)
    saved.config = payload.config.model_dump(mode="json")
    saved.revision = revision + 1
    saved.save()
    return response_for(saved)
