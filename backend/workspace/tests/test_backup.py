import sqlite3
from contextlib import closing
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from zipfile import ZipFile

from django.core.management import call_command
from django.core.management.base import CommandError
from django.conf import settings
from django.test import SimpleTestCase, override_settings


class BackupTests(SimpleTestCase):
    def test_backup_snapshots_wal_database_and_never_overwrites(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            database = root / "workspace.sqlite3"
            (root / ".secret-key").write_text("local-secret", encoding="utf-8")
            (root / "files").mkdir()
            (root / "files" / "sample.txt").write_text("local file", encoding="utf-8")
            output = root / "backups" / "test.zip"
            with closing(sqlite3.connect(database)) as live:
                live.execute("PRAGMA journal_mode=WAL")
                live.execute("CREATE TABLE notes (content TEXT)")
                live.execute("INSERT INTO notes VALUES (?)", ("durable note",))
                live.commit()
                with override_settings(DATA_DIR=root), patch.dict(
                    settings.DATABASES["default"], {"NAME": str(database)}
                ):
                    call_command("backup_workspace", output=output, stdout=StringIO())
                    with self.assertRaises(CommandError):
                        call_command("backup_workspace", output=output, stdout=StringIO())
            with ZipFile(output) as archive:
                self.assertEqual(set(archive.namelist()), {"workspace.sqlite3", ".secret-key", "files/sample.txt"})
                snapshot = root / "restored.sqlite3"
                snapshot.write_bytes(archive.read("workspace.sqlite3"))
            with closing(sqlite3.connect(snapshot)) as restored:
                self.assertEqual(restored.execute("SELECT content FROM notes").fetchone()[0], "durable note")

