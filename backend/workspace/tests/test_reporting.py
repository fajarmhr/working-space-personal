"""Offline scaffold checks only; no U2020, browser, SMTP, Telegram, or scheduler runs."""
from datetime import UTC, datetime
from decimal import Decimal
import unittest
from unittest.mock import Mock, patch

from pydantic import ValidationError

from workspace.reporting import ReportingDraft, analyze_draft, default_draft
from workspace.reporting.config import DatasetDraft, ScheduleDraft
from workspace.reporting.contracts import ReportingNotConfigured, ReportingRunner, SmtpEmailChannel, TelegramPhotoChannel, U2020BrowserSource
from workspace.reporting.csv_reader import normalize_csv, normalize_xlsx
from workspace.reporting.planner import ReportWindow, delivery_action, delivery_key, report_window, retry_delay


def mapping(**updates):
    return DatasetDraft(timestamp_column="time", entity_column="ne", timezone="Asia/Makassar", metrics=[{"key": "cpu", "label": "CPU", "column": "cpu_percent", "unit": "%"}], **updates)


class ReportingScaffoldTests(unittest.TestCase):
    def test_draft_is_inactive_and_has_no_credential_fields(self):
        config = default_draft()
        self.assertFalse(config["enabled"])
        analysis = analyze_draft(config, datetime(2026, 12, 1, tzinfo=UTC))
        self.assertFalse(analysis["active"])
        self.assertFalse(analysis["can_activate"])
        self.assertIn("adapter_validation", {item["code"] for item in analysis["missing_requirements"]})
        for patch in ({"enabled": True}, {"enabled": 0}, {"password": "secret"}):
            with self.subTest(patch=list(patch)), self.assertRaises(ValidationError):
                ReportingDraft.model_validate({**config, **patch})
        for ref in ("123456:actual-bot-token", "token with spaces", "x" * 90):
            config["delivery_profiles"][0]["telegram"]["bot_token_secret_ref"] = ref
            with self.assertRaises(ValidationError):
                ReportingDraft.model_validate(config)

    def test_strict_metadata_and_templates_reject_ambiguous_or_unsafe_values(self):
        bad = [
            {"source": {"base_url": "https://user:password@u2020.example"}},
            {"source": {"base_url": "file:///example"}},
            {"source": {"page_path": "https://other.example/path"}},
            {"schedule": {"timezone": "Wrong/Zone"}},
            {"schedule": {"interval_minutes": True}},
            {"schedule": {"start_at": "2026-12-01T10:00:00"}},
            {"schedule": {"start_at": "2026-12-02T10:00:00+08:00", "end_at": "2026-12-01T10:00:00+08:00"}},
            {"delivery_profiles": [{"email": {"subject_template": "hello\r\nBcc: other@example.test"}}]},
            {"delivery_profiles": [{"telegram": {"caption_template": "{summary.__class__}"}}]},
            {"delivery_profiles": [{"telegram": {"caption_template": "{summary!r}"}}]},
            {"delivery_profiles": [{"id": "same"}, {"id": "same"}]},
        ]
        for value in bad:
            with self.subTest(value=value), self.assertRaises(ValidationError):
                ReportingDraft.model_validate(value)

    def test_fixed_cadence_delay_monitoring_boundaries_and_stable_keys(self):
        schedule = ScheduleDraft(start_at="2026-12-01T00:00:00+08:00", end_at="2026-12-03T00:00:00+08:00", interval_minutes=60, lookback_minutes=60, delay_minutes=10)
        self.assertIsNone(report_window(schedule, datetime.fromisoformat("2026-12-01T01:09:59+08:00")))
        first = report_window(schedule, datetime.fromisoformat("2026-12-01T01:10:00+08:00"))
        same = report_window(schedule, datetime.fromisoformat("2026-12-01T01:59:00+08:00"))
        self.assertEqual(first, same)
        self.assertEqual(first.start.isoformat(), "2026-11-30T16:00:00+00:00")
        self.assertEqual(first.end.isoformat(), "2026-11-30T17:00:00+00:00")
        self.assertIsNone(report_window(schedule, datetime.fromisoformat("2026-12-03T00:00:00+08:00")))
        email = delivery_key("report-1", "personal", first.slot, "email")
        self.assertEqual(email, delivery_key("report-1", "personal", same.slot, "email"))
        self.assertNotEqual(email, delivery_key("report-1", "personal", first.slot, "telegram"))
        self.assertNotEqual(email, delivery_key("report-1", "another", first.slot, "email"))

    def test_retry_keeps_accepted_and_ambiguous_channels_separate(self):
        self.assertEqual(delivery_action("sent", 1), "skip")
        self.assertEqual(delivery_action("unknown", 1), "review")
        self.assertEqual(delivery_action("sending", 1), "locked")
        self.assertEqual(delivery_action("failed", 1), "retry")
        self.assertEqual(delivery_action("failed", 3), "exhausted")
        self.assertEqual([retry_delay(n) for n in (1, 2, 3, 20)], [30, 60, 120, 900])

    def test_runner_and_live_adapters_fail_before_any_external_action(self):
        source, renderer, channel, store = Mock(), Mock(), Mock(), Mock()
        window = ReportWindow(datetime(2026, 12, 1, tzinfo=UTC), datetime(2026, 12, 2, tzinfo=UTC), "test")
        runner = ReportingRunner(source, renderer, [channel], store)
        with self.assertRaises(ReportingNotConfigured):
            runner.run(ReportingDraft(), window)
        source.fetch.assert_not_called()
        renderer.render.assert_not_called()
        channel.send.assert_not_called()
        store.acquire_run.assert_not_called()
        for adapter in (SmtpEmailChannel(), TelegramPhotoChannel()):
            with self.assertRaises(ReportingNotConfigured):
                adapter.send(None, None, "key")
        with self.assertRaises(ReportingNotConfigured):
            U2020BrowserSource().fetch(ReportingDraft(), window)
        with self.assertRaises(ReportingNotConfigured):
            normalize_xlsx(b"", mapping())

    def test_csv_preserves_real_zero_and_offsets_with_complete_window(self):
        now = datetime.fromisoformat("2026-12-01T01:10:00+08:00")
        window = ReportWindow(datetime.fromisoformat("2026-12-01T00:00:00+08:00"), datetime.fromisoformat("2026-12-01T01:00:00+08:00"), "one")
        data = b"\xef\xbb\xbftime,ne,cpu_percent\r\n2026-12-01T00:00:00+08:00,UPFLAB,0\r\n2026-12-01T00:30:00+08:00,UPFLAB,37.125\r\n"
        result = normalize_csv(data, mapping(), window, now=now, expected_interval_minutes=30)
        self.assertTrue(result.can_chart)
        self.assertEqual([point.value for point in result.points], [Decimal("0"), Decimal("37.125")])
        self.assertEqual(result.points[0].timestamp.isoformat(), "2026-11-30T16:00:00+00:00")

    def test_csv_missing_duplicate_stale_and_gaps_cannot_look_healthy(self):
        now = datetime.fromisoformat("2026-12-01T01:10:00+08:00")
        data = b"time,ne,cpu_percent\n2026-12-01T00:00:00+08:00,UPFLAB,0\n2026-12-01T00:00:00+08:00,UPFLAB,5\n2026-12-01T00:30:00+08:00,UPFLAB,\n"
        window = ReportWindow(datetime.fromisoformat("2026-12-01T00:00:00+08:00"), datetime.fromisoformat("2026-12-01T01:00:00+08:00"), "one")
        result = normalize_csv(data, mapping(), window, now=now, expected_interval_minutes=30)
        self.assertFalse(result.can_chart)
        self.assertTrue({"duplicate", "missing_or_invalid_value", "coverage_gap"} <= {issue.code for issue in result.issues})
        stale = b"time,ne,cpu_percent\n2026-11-30T00:00:00+08:00,OLD,5\n2026-12-01T01:00:00+08:00,FRESH,8\n"
        result = normalize_csv(stale, mapping(), now=now)
        self.assertIn("stale", {issue.code for issue in result.issues})
        self.assertFalse(result.can_chart)

    def test_csv_bad_headers_rows_timestamps_and_formats_fail_explicitly(self):
        for data in (b"time,ne,cpu_percent,cpu_percent\n", b"wrong,header\n", b"time,ne,cpu_percent\nnot,time,1,extra\n", b'time,ne,cpu_percent\n"unterminated'):
            with self.subTest(data=data), self.assertRaises(ValueError):
                normalize_csv(data, mapping())
        ambiguous = b"time,ne,cpu_percent\n2026-11-01T01:30:00,UPFLAB,1\n"
        config = mapping()
        config.timezone = "America/New_York"
        result = normalize_csv(ambiguous, config)
        self.assertFalse(result.can_chart)
        self.assertIn("timestamp", {issue.code for issue in result.issues})

    def test_csv_point_and_issue_budgets_fail_without_partial_success(self):
        now = datetime.fromisoformat("2026-12-01T02:00:00+08:00")
        rows = "time,ne,cpu_percent\n" + "\n".join(f"2026-12-01T00:{minute:02d}:00+08:00,UPFLAB,1" for minute in range(3))
        with patch("workspace.reporting.csv_reader.MAX_POINTS", 2), self.assertRaisesRegex(ValueError, "titik"):
            normalize_csv(rows.encode(), mapping(), now=now)
        problems = b"time,ne,cpu_percent\n" + b"bad-time,UPFLAB,1\n" * 1001
        with self.assertRaisesRegex(ValueError, "kualitas data"):
            normalize_csv(problems, mapping(), now=now)
