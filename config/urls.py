"""URLs del proyecto FTA — LogiQ Aduanas."""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("apps.origin.urls")),
    path("api/master/", include("apps.tenants.urls")),
    path("api-auth/", include("rest_framework.urls")),
    path("", include("apps.catalog.urls")),  # portal público de proveedores
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
