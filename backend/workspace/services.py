from django.db import transaction
from django.utils import timezone
from ninja.errors import HttpError

from workspace.models import Activity, QuickNote, ToolFavorite, WorkspacePreferences
from workspace.registry import DEFAULT_FAVORITES, TOOLS, TOOL_IDS


def require_tool(tool_id: str) -> None:
    if tool_id not in TOOL_IDS:
        raise HttpError(404, "Tool tidak ditemukan.")


def tools_with_favorites() -> list[dict]:
    saved = dict(ToolFavorite.objects.values_list("tool_id", "favorite"))
    return [
        {**tool, "favorite": saved.get(tool["id"], tool["id"] in DEFAULT_FAVORITES)}
        for tool in TOOLS
    ]


def preferences() -> WorkspacePreferences:
    return WorkspacePreferences.objects.filter(pk=1).first() or WorkspacePreferences(pk=1)


def note() -> QuickNote:
    return QuickNote.objects.filter(pk=1).first() or QuickNote(pk=1)


@transaction.atomic
def save_preferences(changes: dict) -> WorkspacePreferences:
    current = preferences()
    for field, value in changes.items():
        if value is None:
            raise HttpError(422, f"{field} tidak boleh kosong.")
        setattr(current, field, value.strip() if isinstance(value, str) else value)
    current.save()
    return current


@transaction.atomic
def save_note(content: str) -> QuickNote:
    saved, _ = QuickNote.objects.update_or_create(
        pk=1, defaults={"content": content, "updated_at": timezone.now()}
    )
    return saved


@transaction.atomic
def set_favorite(tool_id: str, favorite: bool) -> dict:
    require_tool(tool_id)
    ToolFavorite.objects.update_or_create(tool_id=tool_id, defaults={"favorite": favorite})
    return {"tool_id": tool_id, "favorite": favorite}


@transaction.atomic
def record_activity(tool_id: str, action: str) -> Activity:
    require_tool(tool_id)
    cleaned = action.strip()
    if not cleaned:
        raise HttpError(422, "Aktivitas tidak boleh kosong.")
    activity = Activity.objects.create(tool_id=tool_id, action=cleaned)
    oldest_kept = Activity.objects.values_list("id", flat=True)[99:100].first()
    if oldest_kept is not None:
        Activity.objects.filter(id__lt=oldest_kept).delete()
    return activity

