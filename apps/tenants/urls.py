from rest_framework.routers import DefaultRouter

from apps.tenants import views

router = DefaultRouter()
router.register("tenants", views.MasterTenantViewSet)
router.register("users", views.MasterUserViewSet)

urlpatterns = router.urls
