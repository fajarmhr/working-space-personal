"""Loopback boundaries and CSRF apply to every API endpoint, including Ninja."""
from ipaddress import ip_address

from django.conf import settings
from django.http import JsonResponse
from django.middleware.csrf import CsrfViewMiddleware


def _protected_api_view(request):
    """Non-exempt callback used to bypass Ninja's blanket csrf_exempt wrapper."""
    return None


class ApiCsrfMiddleware(CsrfViewMiddleware):
    def process_view(self, request, callback, callback_args, callback_kwargs):
        if request.path == "/api" or request.path.startswith("/api/"):
            callback = _protected_api_view
        return super().process_view(request, callback, callback_args, callback_kwargs)


class LocalAccessMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.get_host()  # Enforce ALLOWED_HOSTS even for a static or missing path.
        try:
            loopback = ip_address(request.META.get("REMOTE_ADDR", "")).is_loopback
        except ValueError:
            loopback = False
        if not loopback:
            return JsonResponse({"detail": "Ruang hanya menerima koneksi lokal."}, status=403)
        if (
            request.path.startswith("/api/")
            and request.headers.get("Sec-Fetch-Site") == "cross-site"
        ):
            return JsonResponse({"detail": "Permintaan lintas situs ditolak."}, status=403)

        response = self.get_response(request)
        response["Cross-Origin-Resource-Policy"] = "same-origin"
        if request.path.startswith("/api/"):
            response["Cache-Control"] = "no-store"
        if not settings.DEBUG:
            response["Content-Security-Policy"] = (
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                "img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; "
                "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
            )
        return response

