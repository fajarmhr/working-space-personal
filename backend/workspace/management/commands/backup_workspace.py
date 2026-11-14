"""Create a consistent local backup even while SQLite is in WAL mode."""
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Back up the workspace database and local data to a new ZIP file."

    def add_arguments(self, parser):
        parser.add_argument("--output", type=Path, help="New .zip file; existing files are never overwritten.")

    def handle(self, *args, **options):
        import tempfile

        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        output = options["output"] or settings.DATA_DIR / "backups" / f"ruang-{timestamp}.zip"
        output = output.expanduser().resolve()
        if output.suffix.lower() != ".zip":
            raise CommandError("The backup output must be a .zip file.")
        database = Path(settings.DATABASES["default"]["NAME"])
        if not database.is_file():
            raise CommandError("No workspace database exists. Run migrate first.")
        output.parent.mkdir(parents=True, exist_ok=True)
        try:
            with tempfile.TemporaryDirectory(prefix="ruang-backup-") as temporary:
                snapshot = Path(temporary) / "workspace.sqlite3"
                with closing(sqlite3.connect(database)) as source, closing(sqlite3.connect(snapshot)) as target:
                    source.backup(target)
                with ZipFile(output, mode="x", compression=ZIP_DEFLATED) as archive:
                    archive.write(snapshot, "workspace.sqlite3")
                    secret = settings.DATA_DIR / ".secret-key"
                    if secret.is_file():
                        archive.write(secret, ".secret-key")
                    for folder in ("files", "outputs"):
                        root = settings.DATA_DIR / folder
                        if root.is_dir():
                            for file in root.rglob("*"):
                                if (
                                    file.is_file()
                                    and not file.is_symlink()
                                    and file.resolve().is_relative_to(settings.DATA_DIR)
                                    and file.resolve() != output
                                ):
                                    archive.write(file, file.relative_to(settings.DATA_DIR))
        except FileExistsError as exc:
            raise CommandError("The backup already exists; choose a new output path.") from exc
        self.stdout.write(self.style.SUCCESS(f"Backup created: {output}"))

