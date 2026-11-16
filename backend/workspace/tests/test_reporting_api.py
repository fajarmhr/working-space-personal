import json
from unittest.mock import patch

from django.test import Client, TestCase

from workspace.models import HuaweiReportingDraft, WorkspacePreferences
from workspace.reporting import default_draft


class ReportingDraftApiTests(TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True, HTTP_HOST="127.0.0.1:8000")
        self.token = self.client.get("/api/bootstrap").json()["csrf_token"]

    def enable(self):
        WorkspacePreferences.objects.create(huawei_enabled=True)

    def save(self, config, revision=0, csrf=True):
        return self.client.put(
            "/api/huawei/reporting/draft", data=json.dumps({"config": config, "revision": revision}),
            content_type="application/json", **({"HTTP_X_CSRFTOKEN": self.token} if csrf else {}),
        )

    def test_optional_workspace_and_inactive_default(self):
        self.assertEqual(self.client.get("/api/huawei/reporting/draft").status_code, 403)
        self.enable()
        response = self.client.get("/api/huawei/reporting/draft")
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertFalse(result["config"]["enabled"])
        self.assertFalse(result["readiness"]["active"])
        self.assertFalse(result["readiness"]["can_activate"])
        self.assertTrue(result["readiness"]["missing_requirements"])
        self.assertEqual(result["revision"], 0)
        self.assertFalse(HuaweiReportingDraft.objects.exists())

    def test_draft_round_trip_and_revision_conflict_do_not_overwrite(self):
        self.enable()
        config = default_draft()
        config["name"] = "Holiday monitoring"
        saved = self.save(config)
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json()["revision"], 1)
        self.assertIsNotNone(saved.json()["updated_at"])
        config["name"] = "Stale tab"
        self.assertEqual(self.save(config).status_code, 409)
        self.assertEqual(self.client.get("/api/huawei/reporting/draft").json()["config"]["name"], "Holiday monitoring")
        self.assertEqual(self.save(config, revision=1).json()["revision"], 2)

    def test_rejects_activation_raw_secrets_invalid_window_and_csrf(self):
        self.enable()
        self.assertEqual(self.save(default_draft(), csrf=False).status_code, 403)
        configs = []
        for field, value in (("enabled", True), ("enabled", 0), ("password", "not-accepted")):
            config = default_draft()
            config[field] = value
            configs.append(config)
        config = default_draft()
        config["delivery_profiles"][0]["telegram"]["bot_token_secret_ref"] = "12345:raw-token"
        configs.append(config)
        config = default_draft()
        config["source"]["base_url"] = "https://name:password@u2020.example.invalid"
        configs.append(config)
        config = default_draft()
        config["schedule"]["start_at"] = "2026-12-20T08:00:00"
        configs.append(config)
        for config in configs:
            with self.subTest(config=config):
                self.assertEqual(self.save(config).status_code, 422)
        self.assertFalse(HuaweiReportingDraft.objects.exists())

    @patch("workspace.reporting.contracts.U2020BrowserSource.fetch", side_effect=AssertionError("No live collection"))
    @patch("workspace.reporting.contracts.SmtpEmailChannel.send", side_effect=AssertionError("No email delivery"))
    @patch("workspace.reporting.contracts.TelegramPhotoChannel.send", side_effect=AssertionError("No Telegram delivery"))
    def test_save_does_not_run_configured_channels(self, telegram, email, source):
        self.enable()
        config = default_draft()
        profile = config["delivery_profiles"][0]
        profile["email"].update(enabled=True, to=["monitor@example.invalid"], smtp_secret_ref="RUANG_SMTP_PERSONAL")
        profile["telegram"].update(enabled=True, chat_id="987654321", bot_token_secret_ref="RUANG_TELEGRAM_PERSONAL")
        response = self.save(config)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["readiness"]["can_activate"])
        for collaborator in (telegram, email, source):
            collaborator.assert_not_called()
        self.assertEqual(self.client.post("/api/huawei/reporting/run", HTTP_X_CSRFTOKEN=self.token).status_code, 404)
