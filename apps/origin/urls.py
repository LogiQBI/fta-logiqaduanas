from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.origin import views

router = DefaultRouter()
router.register("treaties", views.TreatyViewSet)
router.register("origin-rules", views.OriginRuleViewSet)
router.register("parties", views.PartyViewSet)
router.register("products", views.ProductViewSet)
router.register("bom-components", views.BOMComponentViewSet)
router.register("supplier-declarations", views.SupplierDeclarationViewSet)
router.register("qualifications", views.QualificationViewSet)
router.register("certificates", views.CertificateViewSet)
router.register("solicitations", views.SolicitationRequestViewSet)

urlpatterns = [
    path("login/", views.login_view, name="api-login"),
    path("me/", views.me, name="api-me"),
    path("change-password/", views.change_password, name="api-change-password"),
    path("supplier-profile/", views.supplier_profile_view, name="supplier-profile"),
] + router.urls
