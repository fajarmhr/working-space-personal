from django.conf import settings
from django.middleware.csrf import get_token
from ninja import NinjaAPI

from workspace import services
from workspace.models import Activity
from workspace.productivity_api import router as productivity_router
from workspace.pdf_conversion_api import router as pdf_router
from workspace.capture_api import router as capture_router
from workspace.schemas import (
    ActivityIn,
    ActivityOut,
    BootstrapOut,
    DeletedOut,
    FavoriteIn,
    FavoriteOut,
    HealthOut,
    NoteIn,
    NoteOut,
    PreferencesOut,
    PreferencesPatch,
)


api = NinjaAPI(
    title="Ruang local workspace",
    version="0.1.0",
    docs_url="/docs" if settings.DEBUG else None,
    openapi_url="/openapi.json" if settings.DEBUG else None,
)
api.add_router('/pdf', pdf_router)
api.add_router('/capture', capture_router)


@api.get("/health", response=HealthOut)
def health(request):
    return {"status": "ok", "version": "0.1.0"}


@api.get("/bootstrap", response=BootstrapOut)
def bootstrap(request):
    return {
        "tools": services.tools_with_favorites(),
        "preferences": services.preferences(),
        "note": services.note(),
        "recent": list(Activity.objects.all()[:100]),
        "csrf_token": get_token(request),
    }


@api.put("/tools/{tool_id}/favorite", response=FavoriteOut)
def favorite(request, tool_id: str, payload: FavoriteIn):
    return services.set_favorite(tool_id, payload.favorite)


@api.put("/note", response=NoteOut)
def update_note(request, payload: NoteIn):
    return services.save_note(payload.content)


@api.patch("/preferences", response=PreferencesOut)
def update_preferences(request, payload: PreferencesPatch):
    return services.save_preferences(payload.model_dump(exclude_unset=True))


@api.post("/activity", response=ActivityOut)
def create_activity(request, payload: ActivityIn):
    return services.record_activity(payload.tool_id, payload.action)


@api.delete("/activity", response=DeletedOut)
def clear_activity(request):
    deleted, _ = Activity.objects.all().delete()
    return {"deleted": deleted}


api.add_router("", productivity_router)

