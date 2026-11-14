"""Exercise the real migrated schema and local backup without touching user data."""
import os
import sqlite3
import subprocess
import sys
from contextlib import closing
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from zipfile import ZipFile

from django.conf import settings
from django.core.management import call_command
from django.test import SimpleTestCase, override_settings


class ProductivityBackupTests(SimpleTestCase):
    def test_full_backup_contains_tasks_snippets_and_existing_notes(self):
        with TemporaryDirectory(prefix="ruang-productivity-backup-") as temporary:
            root = Path(temporary)
            environment = os.environ.copy()
            environment["RUANG_DATA_DIR"] = str(root)
            environment["RUANG_DEBUG"] = "0"
            manage = Path(__file__).resolve().parents[2] / "manage.py"
            result = subprocess.run(
                [sys.executable, str(manage), "migrate", "--noinput"],
                cwd=manage.parent, env=environment, capture_output=True, text=True,
                timeout=30, check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            database = root / "workspace.sqlite3"
            stamp = "2026-11-14 03:27:00"
            with closing(sqlite3.connect(database)) as live:
                live.execute(
                    "INSERT INTO workspace_quicknote (id, content) VALUES (?, ?)",
                    (1, "Catatan sebelum penambahan fitur"),
                )
                live.execute(
                    "INSERT INTO workspace_dailytask "
                    "(title, details, priority, completed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                    ("Laporan mingguan", "Periksa rincian\nKirim setelah selesai", "high", 0, stamp, stamp),
                )
                live.execute(
                    "INSERT INTO workspace_snippet "
                    "(title, content, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                    ("Balasan", "Halo {{nama}},\nTerima kasih.", "Email", stamp, stamp),
                )
                live.commit()
                output = root / "snapshot.zip"
                with override_settings(DATA_DIR=root), patch.dict(
                    settings.DATABASES["default"], {"NAME": str(database)}
                ):
                    call_command("backup_workspace", output=output, stdout=StringIO())
            with ZipFile(output) as archive:
                restored_path = root / "restored.sqlite3"
                restored_path.write_bytes(archive.read("workspace.sqlite3"))
            with closing(sqlite3.connect(restored_path)) as restored:
                self.assertEqual(
                    restored.execute("SELECT content FROM workspace_quicknote").fetchone()[0],
                    "Catatan sebelum penambahan fitur",
                )
                self.assertEqual(
                    restored.execute("SELECT title, priority, completed FROM workspace_dailytask").fetchone(),
                    ("Laporan mingguan", "high", 0),
                )
                self.assertEqual(
                    restored.execute("SELECT content, category FROM workspace_snippet").fetchone(),
                    ("Halo {{nama}},\nTerima kasih.", "Email"),
                )
