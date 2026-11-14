"""Settings for a single-user, loopback-only application."""
import os
import secrets
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BASE_DIR.parent
DATA_DIR = Path(os.environ.get("RUANG_DATA_DIR", PROJECT_DIR / "data")).resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)
DEBUG = os.environ.get("RUANG_DEBUG", "0") == "1"


def _secret_key() -> str:
    configured = os.environ.get("RUANG_SECRET_KEY")
    if configured:
        return configured
    path = DATA_DIR / ".secret-key"
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        value = path.read_text(encoding="utf-8").strip()
        if len(value) < 50:
            raise RuntimeError("The local secret key is invalid. Restore it from a backup.")
        return value
    with os.fdopen(descriptor, "w", encoding="utf-8") as secret_file:
        value = secrets.token_urlsafe(64)
        secret_file.write(value)
    return value


SECRET_KEY = _secret_key()
ALLOWED_HOSTS = ["127.0.0.1", "localhost", "[::1]"]
INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "huey.contrib.djhuey",
    "workspace.apps.WorkspaceConfig",
]
MIDDLEWARE = [
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "workspace.middleware.LocalAccessMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.middleware.common.CommonMiddleware",
    "workspace.middleware.ApiCsrfMiddleware",
]
ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": DATA_DIR / "workspace.sqlite3",
        "OPTIONS": {
            "timeout": 10,
            "transaction_mode": "IMMEDIATE",
            "init_command": "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;",
        },
    }
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
USE_TZ = True
TIME_ZONE = "UTC"
LANGUAGE_CODE = "id"
APPEND_SLASH = False
DATA_UPLOAD_MAX_MEMORY_SIZE = 512 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 2 * 1024 * 1024
FILE_UPLOAD_TEMP_DIR = str(DATA_DIR / 'upload-temp')
Path(FILE_UPLOAD_TEMP_DIR).mkdir(parents=True, exist_ok=True)
DATA_UPLOAD_MAX_NUMBER_FIELDS = 30

CSRF_COOKIE_NAME = "ruang_csrf"
CSRF_COOKIE_HTTPONLY = True
CSRF_COOKIE_SAMESITE = "Strict"
CSRF_COOKIE_SECURE = False  # Loopback HTTP; never exposed to the network.
CSRF_FAILURE_VIEW = "workspace.views.csrf_failure"
CSRF_TRUSTED_ORIGINS = (
    ["http://127.0.0.1:5173", "http://localhost:5173"] if DEBUG else []
)
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"

# This app deliberately uses HTTP on loopback only. TLS redirects and HSTS would
# break the local launcher without a trusted local certificate. Django's deploy
# checks W004 (HSTS) and W008 (SSL redirect) remain visible as documented local
# exceptions; exposing this application to a network requires a new security review.
SECURE_HSTS_SECONDS = 0
SECURE_SSL_REDIRECT = False

# Django's W003 recognizes only the stock middleware dotted path, not subclasses.
# ApiCsrfMiddleware is a CsrfViewMiddleware subclass that additionally enforces
# CSRF on Ninja's normally exempt API wrappers. Real HTTP-client tests cover every
# mutation. A separate deployment check (ruang.E001) fails if it is removed.
SILENCED_SYSTEM_CHECKS = ["security.W003"]

FRONTEND_DIST = PROJECT_DIR / "frontend" / "dist"
STATIC_URL = "/assets/"
STATIC_ROOT = FRONTEND_DIST / "assets"
WHITENOISE_AUTOREFRESH = DEBUG
WHITENOISE_USE_FINDERS = False
WHITENOISE_MAX_AGE = 60 * 60 * 24 * 365

HUEY = {
    "huey_class": "huey.SqliteHuey",
    "name": "ruang",
    "immediate": False,
    "results": True,
    "utc": True,
    "connection": {"filename": str(DATA_DIR / "queue.sqlite3")},
    "consumer": {"workers": 1, "worker_type": "thread"},
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "INFO"},
}

