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
    path("company-profile/", views.company_profile_view, name="company-profile"),
    path("verify/<str:token>/", views.verify_certificate, name="verify-certificate"),
    path("bulk/template/", views.bulk_template, name="bulk-template"),
    path("bulk/import/", views.bulk_import, name="bulk-import"),
] + router.urls
