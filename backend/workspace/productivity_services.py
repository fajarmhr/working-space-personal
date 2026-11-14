"""Small transactions for personal productivity data, separate from shell state."""
from django.db import transaction
from django.db.models import Case, F, IntegerField, Value, When
from ninja.errors import HttpError

from workspace.models import DailyTask, Snippet


TASK_LIMIT = 1000
SNIPPET_LIMIT = 500


def list_tasks():
    return DailyTask.objects.annotate(
        priority_rank=Case(
            When(priority="high", then=Value(0)),
            When(priority="normal", then=Value(1)),
            default=Value(2),
            output_field=IntegerField(),
        )
    ).order_by("completed", F("due_date").asc(nulls_last=True), "priority_rank", "-created_at", "-id")


def _required(model, item_id, label):
    item = model.objects.filter(pk=item_id).first()
    if item is None:
        raise HttpError(404, f"{label} tidak ditemukan.")
    return item


def _reject_nulls(changes, nullable_fields=()):
    for field, value in changes.items():
        if value is None and field not in nullable_fields:
            raise HttpError(422, f"{field} tidak boleh kosong.")


@transaction.atomic
def create_task(values):
    if DailyTask.objects.count() >= TASK_LIMIT:
        raise HttpError(422, "Batas 1.000 tugas tercapai. Hapus tugas yang tidak diperlukan.")
    return DailyTask.objects.create(**values)


@transaction.atomic
def update_task(item_id, changes):
    _reject_nulls(changes, nullable_fields=("due_date",))
    item = _required(DailyTask, item_id, "Tugas")
    if changes:
        for field, value in changes.items():
            setattr(item, field, value)
        item.save(update_fields=[*changes, "updated_at"])
    return item


@transaction.atomic
def delete_task(item_id):
    item = _required(DailyTask, item_id, "Tugas")
    item.delete()
    return {"deleted": 1}


def list_snippets():
    return Snippet.objects.all()


@transaction.atomic
def create_snippet(values):
    if Snippet.objects.count() >= SNIPPET_LIMIT:
        raise HttpError(422, "Batas 500 snippet tercapai. Hapus snippet yang tidak diperlukan.")
    return Snippet.objects.create(**values)


@transaction.atomic
def update_snippet(item_id, changes):
    _reject_nulls(changes)
    item = _required(Snippet, item_id, "Snippet")
    if changes:
        for field, value in changes.items():
            setattr(item, field, value)
        item.save(update_fields=[*changes, "updated_at"])
    return item


@transaction.atomic
def delete_snippet(item_id):
    item = _required(Snippet, item_id, "Snippet")
    item.delete()
    return {"deleted": 1}
