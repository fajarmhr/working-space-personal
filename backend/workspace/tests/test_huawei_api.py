import io
import json
import zipfile
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase

from workspace.huawei_api import package_zip
from workspace.models import Activity, WorkspacePreferences
from workspace.tests.test_huawei_lld import fixture, options


class HuaweiApiTests(TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True, HTTP_HOST="127.0.0.1:8000")
        self.token = self.client.get("/api/bootstrap").json()["csrf_token"]

    def enable(self):
        WorkspacePreferences.objects.update_or_create(pk=1, defaults={"huawei_enabled": True})

    def post(self, path, content=b"not-a-workbook", name="lld.xlsx", options=None, csrf=True):
        data = {"file": SimpleUploadedFile(name, content)}
        if options is not None:
            data["options"] = options if isinstance(options, str) else json.dumps(options)
        return self.client.post(
            path, data=data, **({"HTTP_X_CSRFTOKEN": self.token} if csrf else {}),
        )

    def test_optional_workspace_is_disabled_by_default_and_gates_upload(self):
        prefs = self.client.get("/api/bootstrap").json()["preferences"]
        self.assertFalse(prefs["huawei_enabled"])
        self.assertEqual(prefs["active_workspace"], "personal")
        self.assertEqual(self.post("/api/huawei/inspect").status_code, 403)

    def test_upload_validation_and_csrf(self):
        self.enable()
        for path in ("inspect", "generate", "download"):
            self.assertEqual(self.post(f"/api/huawei/{path}", options={}, csrf=False).status_code, 403)
        self.assertEqual(self.post("/api/huawei/inspect", name="lld.xls").status_code, 422)
        self.assertEqual(self.post("/api/huawei/inspect").status_code, 422)
        for options in ("{", "[]", "null", "x" * 16_385):
            self.assertEqual(self.post("/api/huawei/generate", options=options).status_code, 422)

    @patch("workspace.huawei_lld.inspect_workbook")
    def test_inspection_preserves_no_upload_or_credential_in_database(self, inspect):
        self.enable()
        inspect.return_value = {"nodes": ["UPFTEST07"], "sheets": ["Routing"], "warnings": []}
        response = self.post("/api/huawei/inspect", content=b"sample")
        self.assertEqual(response.status_code, 200)
        inspect.assert_called_once_with(b"sample")
        self.assertEqual(response.json()["nodes"], ["UPFTEST07"])
        self.assertEqual(Activity.objects.count(), 0)
        self.assertEqual(response["Cache-Control"], "no-store")

    @patch("workspace.huawei_lld.generate_package")
    def test_preview_and_zip_use_identical_generated_scripts(self, generate):
        self.enable()
        package = {
            "node": "UPFTEST07", "warnings": ["Check baseline"], "manual_steps": [],
            "template_version": "test-v1", "execution_order": ["01", "02"],
            "rollback_order": ["02", "01"],
            "files": [
                {"name": "01-UPFTEST07-static.ini", "content": "// Preparation\r\nLST INTERFACE:;"},
                {"name": "02-UPFTEST07-bgp.ini", "content": "// Execution\r\nLST BGPPEER:;"},
            ],
        }
        generate.return_value = package
        options = {"node": "UPFTEST07", "bgp_password": "private-value"}
        preview = self.post("/api/huawei/generate", options=options)
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview.json(), package)
        download = self.post("/api/huawei/download", options=options)
        self.assertEqual(download.status_code, 200)
        self.assertEqual(download["Content-Type"], "application/zip")
        self.assertNotIn("Content-Disposition", download)
        with zipfile.ZipFile(io.BytesIO(download.content)) as archive:
            self.assertEqual(len(archive.namelist()), 4)
            for item in package["files"]:
                self.assertEqual(archive.read(item["name"]).decode(), item["content"])
            self.assertNotIn("private-value", archive.read("manifest.json").decode())
        self.assertEqual(package_zip(package), package_zip(package))

    def test_workspace_preference_invariants(self):
        def change(values):
            return self.client.patch(
                "/api/preferences", data=json.dumps(values), content_type="application/json",
                HTTP_X_CSRFTOKEN=self.token,
            )
        self.assertEqual(change({"active_workspace": "huawei"}).status_code, 422)
        enabled = change({"huawei_enabled": True, "active_workspace": "huawei"})
        self.assertEqual(enabled.status_code, 200)
        self.assertEqual(enabled.json()["active_workspace"], "huawei")
        disabled = change({"huawei_enabled": False})
        self.assertEqual(disabled.status_code, 200)
        self.assertEqual(disabled.json()["active_workspace"], "personal")
        persisted = self.client.get("/api/bootstrap").json()["preferences"]
        self.assertFalse(persisted["huawei_enabled"])
        self.assertEqual(persisted["active_workspace"], "personal")
        stored = WorkspacePreferences.objects.get(pk=1)
        self.assertFalse(stored.huawei_enabled)
        self.assertEqual(stored.active_workspace, "personal")
        self.assertEqual(change({"huawei_enabled": "yes"}).status_code, 422)

    def test_real_upload_manual_names_preview_and_zip_round_trip(self):
        self.enable()
        content = fixture()
        inspected = self.post("/api/huawei/inspect", content=content)
        self.assertEqual(inspected.status_code, 200)
        self.assertEqual(inspected.json()["nodes"], ["UPFLAB01"])
        values = options()
        names = values["interface_names"]
        names["200GE1/0/1"] = "100GE8/0/1"
        names["Loopback1"] = "Loopback91"
        for extension in ("txt", "ini"):
            values["extension"] = extension
            preview = self.post("/api/huawei/generate", content=content, options=values)
            self.assertEqual(preview.status_code, 200)
            package = preview.json()
            self.assertTrue(package["requires_review"])
            self.assertEqual(len(package["files"]), 2)
            script = package["files"][0]
            self.assertIn('MEMBERIFNAME="100GE8/0/1"', script["sections"]["execution"])
            self.assertIn('MEMBERIFNAME="100GE8/0/1"', script["sections"]["rollback"])
            self.assertIn('LOCALIFNAME="Loopback91"', package["files"][1]["content"])
            exported = self.post("/api/huawei/download", content=content, options=values)
            self.assertEqual(exported.status_code, 200)
            with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
                for item in package["files"]:
                    self.assertTrue(item["name"].endswith(f".{extension}"))
                    self.assertEqual(archive.read(item["name"]).decode(), item["content"])
                manifest = json.loads(archive.read("manifest.json"))
                self.assertEqual(manifest["rollback_order"], list(reversed(manifest["execution_order"])))
                self.assertEqual(manifest["readiness"], "review_required")
