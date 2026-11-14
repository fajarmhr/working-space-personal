"""Local task and snippet routes. Content is stored as plain text, never executed."""
from ninja import Router

from workspace import productivity_services as services
from workspace.productivity_schemas import (
    SnippetCreate,
    SnippetList,
    SnippetOut,
    SnippetPatch,
    TaskCreate,
    TaskList,
    TaskOut,
    TaskPatch,
)
from workspace.schemas import DeletedOut


router = Router(tags=["Productivity"])


@router.get("/tasks", response=TaskList)
def tasks(request):
    return {"items": list(services.list_tasks())}


@router.post("/tasks", response=TaskOut)
def create_task(request, payload: TaskCreate):
    return services.create_task(payload.model_dump())


@router.patch("/tasks/{item_id}", response=TaskOut)
def update_task(request, item_id: int, payload: TaskPatch):
    return services.update_task(item_id, payload.model_dump(exclude_unset=True))


@router.delete("/tasks/{item_id}", response=DeletedOut)
def delete_task(request, item_id: int):
    return services.delete_task(item_id)


@router.get("/snippets", response=SnippetList)
def snippets(request):
    return {"items": list(services.list_snippets())}


@router.post("/snippets", response=SnippetOut)
def create_snippet(request, payload: SnippetCreate):
    return services.create_snippet(payload.model_dump())


@router.patch("/snippets/{item_id}", response=SnippetOut)
def update_snippet(request, item_id: int, payload: SnippetPatch):
    return services.update_snippet(item_id, payload.model_dump(exclude_unset=True))


@router.delete("/snippets/{item_id}", response=DeletedOut)
def delete_snippet(request, item_id: int):
    return services.delete_snippet(item_id)
