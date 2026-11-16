"""Local-only, stateless LLD preview and script export. Credentials are not saved."""
import hashlib
import io
import json
import re
import zipfile

from django.http import HttpResponse
from ninja import File, Form, Router
from ninja.errors import HttpError
from ninja.files import UploadedFile

from workspace import huawei_lld, services


router = Router(tags=["Huawei workspace"])
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


def _upload(file: UploadedFile) -> bytes:
    if not services.preferences().huawei_enabled:
        raise HttpError(403, "Aktifkan Huawei workspace di Pengaturan terlebih dahulu.")
    if not file.name or not file.name.lower().endswith(".xlsx"):
        raise HttpError(422, "Pilih LLD dalam format .xlsx.")
    if file.size > MAX_UPLOAD_BYTES:
        raise HttpError(413, "Ukuran LLD maksimal 10 MB.")
    data = file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HttpError(413, "Ukuran LLD maksimal 10 MB.")
    return data


def _options(value: str) -> dict:
    if len(value) > 16_384:
        raise HttpError(422, "Parameter generator terlalu besar.")
    try:
        result = json.loads(value)
    except (ValueError, RecursionError) as error:
        raise HttpError(422, "Parameter generator harus berupa JSON yang valid.") from error
    if not isinstance(result, dict):
        raise HttpError(422, "Parameter generator harus berupa objek JSON.")
    return result


def _generate(file: UploadedFile, options: str) -> dict:
    data = _upload(file)
    try:
        return huawei_lld.generate_package(data, _options(options))
    except ValueError as error:
        raise HttpError(422, str(error)) from error


@router.post("/inspect")
def inspect_lld(request, file: File[UploadedFile]):
    data = _upload(file)
    try:
        return huawei_lld.inspect_workbook(data)
    except ValueError as error:
        raise HttpError(422, str(error)) from error


@router.post("/generate")
def generate_lld(request, file: File[UploadedFile], options: Form[str]):
    return _generate(file, options)


def package_zip(package: dict) -> bytes:
    """Deterministic archive with source-free metadata and per-script checksums."""
    entries = []
    manifest = {
        "node": package["node"],
        "template_version": package.get("template_version", "1"),
        "source_sha256": package.get("source_sha256"),
        "readiness": package.get("readiness", "review_required"),
        "manual_steps": package.get("manual_steps", []),
        "execution_order": package.get("execution_order", []),
        "rollback_order": package.get("rollback_order", []),
        "files": [],
    }
    for item in package["files"]:
        name = item["name"]
        if not re.fullmatch(r"[A-Za-z0-9_.() +\-]+\.(?:ini|txt)", name):
            raise ValueError("Nama hasil script tidak valid.")
        content = item["content"].encode("utf-8")
        entries.append((name, content))
        manifest["files"].append({
            "name": name, "sha256": hashlib.sha256(content).hexdigest(),
        })
    guidance = [
        "Huawei LLD change package", "",
        "Execution: Preparation 01 -> Execution 01 -> Verification 01; then the same stages in 02.",
        "Rollback: section rollback 02 first, then rollback 01; verify again afterwards.",
        "Run one section at a time. Do not paste an entire file including rollback.",
        "INI and TXT contain the same Huawei MML syntax.",
        "Keep scripts private: generated peer commands contain the supplied credential.", "",
        "Warnings / prerequisites:",
        *package.get("warnings", []), "", "Manual restoration / validation:",
        *package.get("manual_steps", []),
    ]
    entries.extend([
        ("README.txt", "\r\n".join(guidance).encode("utf-8")),
        ("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False).encode("utf-8")),
    ])
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in entries:
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, content)
    return buffer.getvalue()


@router.post("/download")
def download_lld(request, file: File[UploadedFile], options: Form[str]):
    package = _generate(file, options)
    # The UI fetches this body and names the downloaded Blob. An attachment
    # disposition may be consumed by a browser download handler before fetch.
    return HttpResponse(package_zip(package), content_type="application/zip")
