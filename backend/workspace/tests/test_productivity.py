import json
from datetime import date
from unittest.mock import patch

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import Client, TestCase, TransactionTestCase

from workspace.models import DailyTask, QuickNote, Snippet, WorkspacePreferences


class ProductivityApiTests(TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True, HTTP_HOST="127.0.0.1:8000")
        self.token = self.client.get("/api/bootstrap").json()["csrf_token"]

    def mutate(self, method, path, payload=None, **headers):
        return self.client.generic(
            method, path, data=json.dumps(payload or {}), content_type="application/json",
            HTTP_X_CSRFTOKEN=self.token, **headers,
        )

    def test_empty_collections_do_not_seed_or_overwrite_legacy_state(self):
        QuickNote.objects.create(pk=1, content="Catatan yang sudah ada")
        WorkspacePreferences.objects.create(pk=1, display_name="Nama personal", theme="dark")
        self.assertEqual(self.client.get("/api/tasks").json(), {"items": []})
        self.assertEqual(self.client.get("/api/snippets").json(), {"items": []})
        self.assertEqual(QuickNote.objects.get(pk=1).content, "Catatan yang sudah ada")
        self.assertEqual(WorkspacePreferences.objects.get(pk=1).theme, "dark")

    def test_task_crud_preserves_details_on_completion_and_can_clear_due_date(self):
        response = self.mutate("POST", "/api/tasks", {
            "title": "  Susun laporan  ", "details": "Baris pertama\n  Baris kedua  ",
            "priority": "high", "due_date": "2026-11-14",
        })
        self.assertEqual(response.status_code, 200)
        task = response.json()
        self.assertEqual(task["title"], "Susun laporan")
        self.assertEqual(task["details"], "Baris pertama\n  Baris kedua  ")
        self.assertFalse(task["completed"])
        self.assertIsNotNone(task["created_at"])
        changed = self.mutate("PATCH", f"/api/tasks/{task['id']}", {"completed": True})
        self.assertEqual(changed.status_code, 200)
        self.assertTrue(changed.json()["completed"])
        self.assertEqual(changed.json()["details"], task["details"])
        self.assertEqual(changed.json()["due_date"], "2026-11-14")
        self.assertEqual(changed.json()["created_at"], task["created_at"])
        cleared = self.mutate("PATCH", f"/api/tasks/{task['id']}", {"due_date": None})
        self.assertEqual(cleared.status_code, 200)
        self.assertIsNone(cleared.json()["due_date"])
        another = Client(HTTP_HOST="localhost:8000")
        self.assertEqual(another.get("/api/tasks").json()["items"][0]["details"], task["details"])
        self.assertEqual(self.mutate("DELETE", f"/api/tasks/{task['id']}").json(), {"deleted": 1})
        self.assertEqual(DailyTask.objects.count(), 0)

    def test_task_order_is_stable_with_missing_dates_and_completed_items(self):
        finished = DailyTask.objects.create(title="Selesai", completed=True, due_date=date(2026, 1, 1))
        undated = DailyTask.objects.create(title="Tanpa tanggal", priority="high")
        low = DailyTask.objects.create(title="Rendah", priority="low", due_date=date(2026, 11, 14))
        high = DailyTask.objects.create(title="Tinggi", priority="high", due_date=date(2026, 11, 14))
        self.assertEqual(
            [item["id"] for item in self.client.get("/api/tasks").json()["items"]],
            [high.id, low.id, undated.id, finished.id],
        )

    def test_task_validation_rejects_invalid_dates_unknown_fields_and_null_overwrites(self):
        for payload in [
            {"title": "   "}, {"title": "x" * 181}, {"title": "A", "details": "x" * 4001},
            {"title": "A", "due_date": "2026-02-30"},
            {"title": "A", "due_date": "20261114"},
            {"title": "A", "due_date": 1794614400},
            {"title": "A", "priority": "urgent"}, {"title": "A", "completed": True},
        ]:
            with self.subTest(payload_keys=list(payload)):
                self.assertEqual(self.mutate("POST", "/api/tasks", payload).status_code, 422)
        item = DailyTask.objects.create(title="Tetap tersimpan", details="Isi awal")
        for payload in [
            {"title": None}, {"details": None}, {"priority": None},
            {"completed": None}, {"completed": "true"}, {"completed": 1}, {"unknown": True},
        ]:
            with self.subTest(payload_keys=list(payload)):
                self.assertEqual(self.mutate("PATCH", f"/api/tasks/{item.id}", payload).status_code, 422)
        item.refresh_from_db()
        self.assertEqual(item.title, "Tetap tersimpan")
        self.assertEqual(item.details, "Isi awal")
        self.assertFalse(item.completed)

    def test_snippet_crud_preserves_exact_plaintext_and_partial_updates(self):
        content = "  Halo {{nama}},\n<script>teks biasa</script>\n  Salam.  "
        response = self.mutate("POST", "/api/snippets", {
            "title": "  Balasan laporan  ", "content": content, "category": "  Email  ",
        })
        self.assertEqual(response.status_code, 200)
        snippet = response.json()
        self.assertEqual(snippet["title"], "Balasan laporan")
        self.assertEqual(snippet["category"], "Email")
        self.assertEqual(snippet["content"], content)
        changed = self.mutate("PATCH", f"/api/snippets/{snippet['id']}", {"title": "Balasan baru"})
        self.assertEqual(changed.status_code, 200)
        self.assertEqual(changed.json()["content"], content)
        self.assertEqual(changed.json()["category"], "Email")
        another = Client(HTTP_HOST="localhost:8000")
        self.assertEqual(another.get("/api/snippets").json()["items"][0]["title"], "Balasan baru")
        self.assertEqual(self.mutate("DELETE", f"/api/snippets/{snippet['id']}").json(), {"deleted": 1})
        self.assertEqual(Snippet.objects.count(), 0)

    def test_snippet_validation_and_default_category(self):
        for payload in [
            {"title": " ", "content": "A"}, {"title": "A", "content": "  \n "},
            {"title": "x" * 121, "content": "A"}, {"title": "A", "content": "x" * 20001},
            {"title": "A", "content": "B", "category": " "},
            {"title": "A", "content": "B", "category": "x" * 41},
        ]:
            with self.subTest(payload_keys=list(payload)):
                self.assertEqual(self.mutate("POST", "/api/snippets", payload).status_code, 422)
        response = self.mutate("POST", "/api/snippets", {"title": "Pesan", "content": "Isi"})
        self.assertEqual(response.status_code, 200)
        item = response.json()
        self.assertEqual(item["category"], "Umum")
        for field in ("title", "content", "category"):
            with self.subTest(field=field):
                self.assertEqual(
                    self.mutate("PATCH", f"/api/snippets/{item['id']}", {field: None}).status_code, 422
                )

    def test_unknown_records_return_404_and_empty_patch_is_safe(self):
        for resource in ("tasks", "snippets"):
            self.assertEqual(self.mutate("PATCH", f"/api/{resource}/999999", {}).status_code, 404)
            self.assertEqual(self.mutate("DELETE", f"/api/{resource}/999999").status_code, 404)
        task = DailyTask.objects.create(title="Ada")
        before = task.updated_at
        self.assertEqual(self.mutate("PATCH", f"/api/tasks/{task.id}", {}).status_code, 200)
        task.refresh_from_db()
        self.assertEqual(task.updated_at, before)

    def test_every_productivity_mutation_requires_csrf_and_rejects_foreign_origin(self):
        task = DailyTask.objects.create(title="Ada")
        snippet = Snippet.objects.create(title="Ada", content="Isi")
        operations = [
            ("POST", "/api/tasks", {"title": "Forged"}),
            ("PATCH", f"/api/tasks/{task.id}", {"completed": True}),
            ("DELETE", f"/api/tasks/{task.id}", {}),
            ("POST", "/api/snippets", {"title": "Forged", "content": "Isi"}),
            ("PATCH", f"/api/snippets/{snippet.id}", {"content": "Forged"}),
            ("DELETE", f"/api/snippets/{snippet.id}", {}),
        ]
        for method, path, payload in operations:
            with self.subTest(method=method, path=path):
                forged = self.client.generic(method, path, data=json.dumps(payload), content_type="application/json")
                self.assertEqual(forged.status_code, 403)
                foreign = self.mutate(method, path, payload, HTTP_ORIGIN="https://untrusted.example")
                self.assertEqual(foreign.status_code, 403)
        self.assertEqual(DailyTask.objects.count(), 1)
        self.assertEqual(Snippet.objects.get(pk=snippet.id).content, "Isi")

    def test_collection_caps_reject_creation_without_removing_existing_records(self):
        DailyTask.objects.create(title="Existing")
        Snippet.objects.create(title="Existing", content="Isi")
        with patch("workspace.productivity_services.TASK_LIMIT", 1):
            response = self.mutate("POST", "/api/tasks", {"title": "Extra"})
            self.assertEqual(response.status_code, 422)
        with patch("workspace.productivity_services.SNIPPET_LIMIT", 1):
            response = self.mutate("POST", "/api/snippets", {"title": "Extra", "content": "Isi"})
            self.assertEqual(response.status_code, 422)
        self.assertEqual(DailyTask.objects.count(), 1)
        self.assertEqual(Snippet.objects.count(), 1)


class ProductivityMigrationTests(TransactionTestCase):
    def test_adding_productivity_tables_preserves_existing_personal_data(self):
        previous = [("workspace", "0001_initial")]
        target = [("workspace", "0002_daily_tasks_and_snippets")]
        executor = MigrationExecutor(connection)
        executor.migrate(previous)
        try:
            old_apps = executor.loader.project_state(previous).apps
            old_apps.get_model("workspace", "QuickNote").objects.create(pk=1, content="Catatan lama")
            old_apps.get_model("workspace", "WorkspacePreferences").objects.create(
                pk=1, display_name="Nama lama", theme="dark", focus_minutes=37,
            )
            executor = MigrationExecutor(connection)
            executor.migrate(target)
            new_apps = executor.loader.project_state(target).apps
            self.assertEqual(new_apps.get_model("workspace", "QuickNote").objects.get(pk=1).content, "Catatan lama")
            profile = new_apps.get_model("workspace", "WorkspacePreferences").objects.get(pk=1)
            self.assertEqual((profile.display_name, profile.theme, profile.focus_minutes), ("Nama lama", "dark", 37))
            self.assertEqual(new_apps.get_model("workspace", "DailyTask").objects.count(), 0)
            self.assertEqual(new_apps.get_model("workspace", "Snippet").objects.count(), 0)
        finally:
            MigrationExecutor(connection).migrate(target)
