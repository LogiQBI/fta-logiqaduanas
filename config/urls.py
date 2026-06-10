"""URLs del proyecto FTA — LogiQ Aduanas."""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import FileResponse, HttpResponse
from django.urls import include, path, re_path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("apps.origin.urls")),
    path("api/master/", include("apps.tenants.urls")),
    path("api-auth/", include("rest_framework.urls")),
    path("", include("apps.catalog.urls")),  # portal público de proveedores
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)


def spa_index(request):
    """Sirve la app de Next.js (index.html) para las rutas del frontend.
    Los assets (/_next, logos) los entrega WhiteNoise antes de llegar aquí."""
    index = settings.FRONTEND_BUILD_DIR / "index.html"
    if index.exists():
        resp = FileResponse(open(index, "rb"))
        # El index NO se cachea: así cada deploy se ve de inmediato (los chunks
        # con hash sí se cachean, los sirve WhiteNoise). Evita versiones viejas.
        resp["Cache-Control"] = "no-cache, no-store, must-revalidate"
        resp["Pragma"] = "no-cache"
        resp["Expires"] = "0"
        return resp
    return HttpResponse("Frontend no desplegado en este servicio.", status=404)


# Catch-all: todo lo que NO sea API/admin/portal/estáticos -> la SPA (frontend).
urlpatterns += [
    re_path(r"^(?!api/|admin/|api-auth/|portal/|media/|static/).*$", spa_index),
]
