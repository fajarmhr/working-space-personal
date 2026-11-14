from django.conf import settings
from django.http import FileResponse, HttpResponse, JsonResponse
from django.views.decorators.http import require_safe


def csrf_failure(request, reason=""):
    return JsonResponse(
        {"detail": "Sesi keamanan kedaluwarsa. Muat ulang halaman lalu coba lagi."}, status=403
    )


@require_safe
def frontend(request):
    """Serve the built app; never interpret a browser path as a filesystem path."""
    index = settings.FRONTEND_DIST / "index.html"
    if not index.is_file():
        return HttpResponse(
            "Frontend belum dibangun. Jalankan pnpm build di folder frontend.",
            status=503,
            content_type="text/plain; charset=utf-8",
        )
    response = FileResponse(index.open("rb"), content_type="text/html; charset=utf-8")
    response["Cache-Control"] = "no-cache"
    return response

