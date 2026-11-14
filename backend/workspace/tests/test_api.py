import json
from pathlib import Path
from tempfile import TemporaryDirectory

from django.test import Client, TestCase, override_settings

from workspace.models import Activity, QuickNote, ToolFavorite, WorkspacePreferences


class WorkspaceApiTests(TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True, HTTP_HOST="127.0.0.1:8000")
        response = self.client.get("/api/bootstrap")
        self.assertEqual(response.status_code, 200)
        self.token = response.json()["csrf_token"]

    def mutate(self, method, path, payload=None, **headers):
        return self.client.generic(
            method,
            path,
            data=json.dumps(payload or {}),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=self.token,
            **headers,
        )

    def test_bootstrap_has_real_empty_state_and_csrf_cookie(self):
        response = self.client.get("/api/bootstrap")
        data = response.json()
        tool_ids = [tool["id"] for tool in data["tools"]]
        self.assertEqual(len(tool_ids), len(set(tool_ids)))
        self.assertTrue({"json-formatter", "focus-timer", "quick-note"}.issubset(tool_ids))
        self.assertEqual(data["recent"], [])
        self.assertEqual(data["note"], {"content": "", "updated_at": None})
        self.assertEqual(data["preferences"]["focus_minutes"], 25)
        self.assertTrue(response.cookies["ruang_csrf"]["httponly"])
        self.assertEqual(response.cookies["ruang_csrf"]["samesite"], "Strict")
        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertEqual(Activity.objects.count(), 0)
        self.assertEqual(QuickNote.objects.count(), 0)
        self.assertEqual(WorkspacePreferences.objects.count(), 0)

    def test_note_persists_and_can_be_cleared(self):
        content = "Ide hari ini\nTeks Unicode: kopi dan ruang kerja."
        saved = self.mutate("PUT", "/api/note", {"content": content})
        self.assertEqual(saved.status_code, 200)
        self.assertIsNotNone(saved.json()["updated_at"])
        another_client = Client(HTTP_HOST="localhost:8000")
        self.assertEqual(another_client.get("/api/bootstrap").json()["note"]["content"], content)
        self.assertEqual(self.mutate("PUT", "/api/note", {"content": ""}).status_code, 200)
        self.assertEqual(QuickNote.objects.get(pk=1).content, "")

    def test_favorite_toggle_persists_without_duplicate_rows(self):
        for favorite in (False, True, False):
            response = self.mutate(
                "PUT", "/api/tools/json-formatter/favorite", {"favorite": favorite}
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {"tool_id": "json-formatter", "favorite": favorite})
        self.assertEqual(ToolFavorite.objects.count(), 1)
        tools = self.client.get("/api/bootstrap").json()["tools"]
        self.assertFalse(next(tool for tool in tools if tool["id"] == "json-formatter")["favorite"])

    def test_preferences_partial_update_preserves_other_values(self):
        response = self.mutate(
            "PATCH", "/api/preferences", {"display_name": "  Madi  ", "focus_minutes": 40}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["display_name"], "Madi")
        self.assertEqual(response.json()["focus_minutes"], 40)
        self.assertEqual(response.json()["break_minutes"], 5)
        self.assertEqual(self.mutate("PATCH", "/api/preferences", {"theme": "dark"}).status_code, 200)
        self.assertEqual(self.client.get("/api/bootstrap").json()["preferences"]["focus_minutes"], 40)

    def test_invalid_inputs_never_reach_database(self):
        examples = [
            ("PUT", "/api/note", {"content": "x" * 100_001}),
            ("PATCH", "/api/preferences", {"theme": "purple"}),
            ("PATCH", "/api/preferences", {"focus_minutes": 0}),
            ("PATCH", "/api/preferences", {"focus_minutes": 181}),
            ("PATCH", "/api/preferences", {"focus_minutes": True}),
            ("PATCH", "/api/preferences", {"break_minutes": 61}),
            ("PATCH", "/api/preferences", {"display_name": None}),
            ("PATCH", "/api/preferences", {"unknown": "value"}),
            ("PUT", "/api/tools/json-formatter/favorite", {"favorite": "yes"}),
            ("POST", "/api/activity", {"tool_id": "base64", "action": " "}),
            ("POST", "/api/activity", {"tool_id": "base64", "action": "x" * 161}),
        ]
        for method, path, payload in examples:
            with self.subTest(path=path, payload=list(payload.keys())):
                self.assertEqual(self.mutate(method, path, payload).status_code, 422)
        self.assertEqual(QuickNote.objects.count(), 0)
        self.assertEqual(WorkspacePreferences.objects.count(), 0)
        self.assertEqual(Activity.objects.count(), 0)
        self.assertEqual(ToolFavorite.objects.count(), 0)

    def test_unknown_tool_is_rejected(self):
        favorite = self.mutate("PUT", "/api/tools/not-a-tool/favorite", {"favorite": True})
        activity = self.mutate("POST", "/api/activity", {"tool_id": "not-a-tool", "action": "Opened"})
        self.assertEqual(favorite.status_code, 404)
        self.assertEqual(activity.status_code, 404)

    def test_activity_retention_and_delete(self):
        Activity.objects.bulk_create(
            [Activity(tool_id="json-formatter", action=f"Action {index}") for index in range(105)]
        )
        response = self.mutate(
            "POST", "/api/activity", {"tool_id": "json-formatter", "action": "JSON dirapikan"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Activity.objects.count(), 100)
        recent = self.client.get("/api/bootstrap").json()["recent"]
        self.assertEqual(recent[0]["action"], "JSON dirapikan")
        self.assertEqual(self.mutate("DELETE", "/api/activity").json(), {"deleted": 100})
        self.assertEqual(Activity.objects.count(), 0)

    def test_all_mutating_endpoints_require_csrf(self):
        for method, path, payload in [
            ("PUT", "/api/note", {"content": "forged"}),
            ("PATCH", "/api/preferences", {"display_name": "forged"}),
            ("PUT", "/api/tools/base64/favorite", {"favorite": True}),
            ("POST", "/api/activity", {"tool_id": "base64", "action": "forged"}),
            ("DELETE", "/api/activity", {}),
        ]:
            with self.subTest(method=method, path=path):
                response = self.client.generic(
                    method, path, data=json.dumps(payload), content_type="application/json"
                )
                self.assertEqual(response.status_code, 403)
                self.assertIn("detail", response.json())

    def test_wrong_token_and_foreign_origin_are_rejected(self):
        wrong = self.client.put(
            "/api/note", data=json.dumps({"content": "forged"}),
            content_type="application/json", HTTP_X_CSRFTOKEN="a" * 64,
        )
        self.assertEqual(wrong.status_code, 403)
        foreign = self.mutate(
            "PUT", "/api/note", {"content": "forged"}, HTTP_ORIGIN="https://untrusted.example"
        )
        self.assertEqual(foreign.status_code, 403)
        self.assertEqual(QuickNote.objects.count(), 0)
        same_origin = self.mutate(
            "PUT", "/api/note", {"content": "safe"}, HTTP_ORIGIN="http://127.0.0.1:8000"
        )
        self.assertEqual(same_origin.status_code, 200)

    def test_local_boundaries_and_unknown_api(self):
        self.assertEqual(self.client.get("/api/health", HTTP_HOST="untrusted.example").status_code, 400)
        self.assertEqual(self.client.get("/api/health", REMOTE_ADDR="192.168.1.9").status_code, 403)
        self.assertEqual(self.client.get("/api/bootstrap", HTTP_SEC_FETCH_SITE="cross-site").status_code, 403)
        self.assertEqual(self.client.get("/api/not-a-route").status_code, 404)
        self.assertEqual(self.client.get("/api").status_code, 404)
        self.assertEqual(self.client.get("/assets/not-a-file.js").status_code, 404)

    @override_settings(DEBUG=False)
    def test_daily_mode_has_security_headers_and_no_public_schema(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertIn("script-src 'self'", response["Content-Security-Policy"])
        self.assertEqual(response["X-Frame-Options"], "DENY")
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
        self.assertEqual(self.client.get("/api/openapi.json").status_code, 404)
        self.assertEqual(self.client.get("/api/docs").status_code, 404)

    def test_spa_fallback_is_safe_and_does_not_read_arbitrary_paths(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "index.html").write_text("<html>Ruang</html>", encoding="utf-8")
            with override_settings(FRONTEND_DIST=root):
                response = self.client.get("/tools/json-formatter")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(b"".join(response.streaming_content), b"<html>Ruang</html>")
                traversal = self.client.get("/../../backend/pyproject.toml")
                self.assertEqual(b"".join(traversal.streaming_content), b"<html>Ruang</html>")

