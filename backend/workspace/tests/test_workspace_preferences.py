import json

from django.test import Client, TestCase

from workspace.models import Activity, DailyTask, QuickNote, Snippet, ToolFavorite, WorkspacePreferences


class WorkspacePreferencePersistenceTests(TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True, HTTP_HOST="127.0.0.1:8000")
        self.token = self.client.get("/api/bootstrap").json()["csrf_token"]

    def change(self, values):
        return self.client.patch(
            "/api/preferences",
            data=json.dumps(values),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=self.token,
        )

    def test_disable_persists_personal_selection_without_deleting_shared_work(self):
        QuickNote.objects.create(pk=1, content="Catatan kerja")
        task = DailyTask.objects.create(title="Periksa LLD")
        snippet = Snippet.objects.create(title="Template kerja", content="LST INTERFACE:;")
        ToolFavorite.objects.create(tool_id="huawei-lld", favorite=True)
        Activity.objects.create(tool_id="huawei-lld", action="Membuat paket script")

        self.assertEqual(
            self.change({"huawei_enabled": True, "active_workspace": "huawei"}).status_code,
            200,
        )
        self.assertEqual(self.change({"huawei_enabled": False}).status_code, 200)

        saved = WorkspacePreferences.objects.get(pk=1)
        self.assertFalse(saved.huawei_enabled)
        self.assertEqual(saved.active_workspace, "personal")
        fresh = Client(HTTP_HOST="127.0.0.1:8000").get("/api/bootstrap").json()
        self.assertFalse(fresh["preferences"]["huawei_enabled"])
        self.assertEqual(fresh["preferences"]["active_workspace"], "personal")
        self.assertEqual(fresh["note"]["content"], "Catatan kerja")
        self.assertEqual(fresh["recent"][0]["tool_id"], "huawei-lld")
        self.assertTrue(next(tool for tool in fresh["tools"] if tool["id"] == "huawei-lld")["favorite"])
        self.assertTrue(DailyTask.objects.filter(pk=task.pk).exists())
        self.assertTrue(Snippet.objects.filter(pk=snippet.pk).exists())

        self.assertEqual(self.change({"huawei_enabled": True}).status_code, 200)
        saved.refresh_from_db()
        self.assertTrue(saved.huawei_enabled)
        self.assertEqual(saved.active_workspace, "personal")

    def test_other_settings_preserve_selected_workspace(self):
        self.assertEqual(
            self.change({"huawei_enabled": True, "active_workspace": "huawei"}).status_code,
            200,
        )
        self.assertEqual(self.change({"theme": "dark", "display_name": "Operator"}).status_code, 200)
        saved = WorkspacePreferences.objects.get(pk=1)
        self.assertEqual(saved.theme, "dark")
        self.assertEqual(saved.display_name, "Operator")
        self.assertTrue(saved.huawei_enabled)
        self.assertEqual(saved.active_workspace, "huawei")

    def test_invalid_combined_change_leaves_previous_preferences_intact(self):
        self.assertEqual(
            self.change({"huawei_enabled": True, "active_workspace": "huawei"}).status_code,
            200,
        )
        self.assertEqual(
            self.change({"huawei_enabled": False, "active_workspace": "huawei"}).status_code,
            422,
        )
        saved = WorkspacePreferences.objects.get(pk=1)
        self.assertTrue(saved.huawei_enabled)
        self.assertEqual(saved.active_workspace, "huawei")
