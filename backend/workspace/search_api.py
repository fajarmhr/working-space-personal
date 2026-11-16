"""Bounded search across the small, shared personal content collections."""
import re
from datetime import datetime
from typing import Literal

from ninja import Query, Router, Schema
from pydantic import Field

from workspace.models import DailyTask, QuickNote, Snippet


router = Router(tags=["Global search"])
PER_KIND_LIMIT = 10


class SearchHit(Schema):
    kind: Literal["note", "task", "snippet"]
    id: int
    title: str
    excerpt: str
    updated_at: datetime | None
    completed: bool | None = None


class SearchResults(Schema):
    query: str
    items: list[SearchHit]
    has_more: bool


class SearchQuery(Schema):
    q: str = Field(min_length=0, max_length=200)


def excerpt(text: str, query: str, length: int = 180) -> str:
    """Plain text only: the frontend never needs HTML to show a matched passage."""
    cleaned = re.sub(r"\s+", " ", text).strip()
    match = re.search(re.escape(query), cleaned, re.IGNORECASE)
    position = match.start() if match else 0
    if match is None:
        folded_position = cleaned.casefold().find(query.casefold())
        if folded_position >= 0:
            accumulated = 0
            for index, character in enumerate(cleaned):
                if accumulated >= folded_position:
                    position = index
                    break
                accumulated += len(character.casefold())
    start = max(0, position - 55)
    end = min(len(cleaned), start + length)
    return ("…" if start else "") + cleaned[start:end] + ("…" if end < len(cleaned) else "")


def search_content(query: str) -> dict:
    query = query.strip()
    if len(query) < 2:
        return {"query": query, "items": [], "has_more": False}
    folded = query.casefold()
    items = []
    has_more = False
    note = QuickNote.objects.filter(pk=1).first()
    if note and folded in note.content.casefold():
        items.append({
            "kind": "note", "id": 1, "title": "Catatan cepat",
            "excerpt": excerpt(note.content, query), "updated_at": note.updated_at,
        })
    # Collections are capped elsewhere at 1,000 tasks and 500 snippets. Streaming
    # selected fields keeps Unicode casefold search correct without loading all
    # content into bootstrap, adding an index worker, or storing a second copy.
    collections = (
        ("task", DailyTask.objects.only("id", "title", "details", "updated_at", "completed")
         .order_by("completed", "-updated_at", "-id"), ("title", "details")),
        ("snippet", Snippet.objects.only("id", "title", "content", "category", "updated_at")
         .order_by("-updated_at", "-id"), ("title", "content", "category")),
    )
    for kind, records, fields in collections:
        matches = []
        for record in records.iterator(chunk_size=100):
            values = [getattr(record, field) for field in fields]
            if not any(folded in value.casefold() for value in values):
                continue
            body = record.details if kind == "task" else record.content
            rank = 0 if folded in record.title.casefold() else 1
            if not body or folded not in body.casefold():
                body = record.title if rank == 0 else getattr(record, "category", body)
            hit = {
                "kind": kind, "id": record.id, "title": record.title,
                "excerpt": excerpt(body, query), "updated_at": record.updated_at,
            }
            if kind == "task":
                hit["completed"] = record.completed
            matches.append((rank, hit))
        matches.sort(key=lambda item: item[0])
        has_more |= len(matches) > PER_KIND_LIMIT
        items.extend(hit for _, hit in matches[:PER_KIND_LIMIT])
    return {"query": query, "items": items, "has_more": has_more}


@router.get("/search", response=SearchResults)
def global_search(request, query: Query[SearchQuery]):
    return search_content(query.q)
