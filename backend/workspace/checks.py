"""Django's stock CSRF presence check does not recognize custom subclasses."""
from django.conf import settings
from django.core.checks import Error, Tags, register


@register(Tags.security, deploy=True)
def api_csrf_protection(app_configs, **kwargs):
    if "workspace.middleware.ApiCsrfMiddleware" not in settings.MIDDLEWARE:
        return [
            Error(
                "The local API CSRF protection middleware is missing.",
                hint=(
                    "Restore workspace.middleware.ApiCsrfMiddleware. Stock CSRF middleware "
                    "alone does not protect Django Ninja's CSRF-exempt API wrappers."
                ),
                id="ruang.E001",
            )
        ]
    return []

