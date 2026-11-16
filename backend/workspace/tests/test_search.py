from django.test import Client, TestCase

from workspace.models import DailyTask, QuickNote, Snippet, WorkspacePreferences


class GlobalSearchTests(TestCase):
    def setUp(self):
        self.client = Client(HTTP_HOST="127.0.0.1:8000")

    def search(self, query):
        response = self.client.get("/api/search", {"q": query})
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_searches_shared_note_task_details_and_snippet_category(self):
        QuickNote.objects.create(content="Persiapan monitoring liburan")
        task = DailyTask.objects.create(title="UPF review", details="Monitoring BFD harian", completed=True)
        snippet = Snippet.objects.create(title="Command", content="LST BGPPEER:;", category="Monitoring")
        WorkspacePreferences.objects.create(huawei_enabled=False)
        results = self.search("MONITORING")
        self.assertEqual([(hit["kind"], hit["id"]) for hit in results["items"]], [
            ("note", 1), ("task", task.id), ("snippet", snippet.id),
        ])
        self.assertTrue(results["items"][1]["completed"])
        self.assertFalse(results["has_more"])

    def test_unicode_casefold_and_literal_special_characters(self):
        task = DailyTask.objects.create(title="ÉTÉ Straße", details="Literal %_ <script> data")
        self.assertEqual(self.search("été")["items"][0]["id"], task.id)
        self.assertEqual(self.search("STRASSE")["items"][0]["id"], task.id)
        self.assertEqual(self.search("%_")["items"][0]["id"], task.id)
        self.assertEqual(self.search("no-such-value")["items"], [])
        Snippet.objects.create(title="Unicode excerpt", content="prefix " * 100 + "Straße traffic")
        results = self.search("STRASSE")
        passage = next(hit["excerpt"] for hit in results["items"] if hit["kind"] == "snippet")
        self.assertIn("Straße", passage)

    def test_results_are_bounded_rank_titles_and_show_context(self):
        DailyTask.objects.bulk_create([
            DailyTask(title=f"Item {i}", details="x " * 300 + "needle context") for i in range(12)
        ])
        title_hit = DailyTask.objects.create(title="needle important")
        results = self.search("needle")
        self.assertEqual(len(results["items"]), 10)
        self.assertTrue(results["has_more"])
        self.assertEqual(results["items"][0]["id"], title_hit.id)
        self.assertIn("needle", results["items"][1]["excerpt"])
        self.assertLessEqual(len(results["items"][1]["excerpt"]), 182)
        self.assertNotIn("details", results["items"][1])

    def test_blank_and_short_queries_do_not_dump_collections(self):
        QuickNote.objects.create(content="private local note")
        for query in ("", " ", "a", " a "):
            self.assertEqual(self.search(query)["items"], [])
        self.assertEqual(self.client.get("/api/search", {"q": "x" * 201}).status_code, 422)

    def test_deleted_records_disappear_and_results_do_not_write_data(self):
        task = DailyTask.objects.create(title="Temporary monitoring")
        self.assertEqual(len(self.search("monitoring")["items"]), 1)
        task.delete()
        self.assertEqual(self.search("monitoring")["items"], [])
        self.assertFalse(WorkspacePreferences.objects.exists())
