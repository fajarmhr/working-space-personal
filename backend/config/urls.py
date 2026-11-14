from django.urls import path, re_path

from workspace.api import api
from workspace.views import frontend


urlpatterns = [
    path("api/", api.urls),
    re_path(r"^(?!api(?:/|$)|assets(?:/|$)).*$", frontend),
]

