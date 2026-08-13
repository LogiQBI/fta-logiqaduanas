from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.origin import views
from apps.tenants.views import CompanyUserViewSet

router = DefaultRouter()
# Usuarios del equipo de la empresa (los gestiona el ADMIN del tenant).
router.register("company/users", CompanyUserViewSet, basename="company-users")
router.register("treaties", views.TreatyViewSet)
router.register("origin-rules", views.OriginRuleViewSet)
router.register("parties", views.PartyViewSet)
router.register("products", views.ProductViewSet)
router.register("bom-components", views.BOMComponentViewSet)
router.register("supplier-declarations", views.SupplierDeclarationViewSet)
router.register("qualifications", views.QualificationViewSet)
router.register("origin-analyses", views.OriginAnalysisViewSet)
router.register("certificates", views.CertificateViewSet)
router.register("solicitation-certificates", views.SolicitationCertificateViewSet)
router.register("client-layouts", views.ClientLayoutViewSet)
router.register("solicitations", views.SolicitationRequestViewSet)
router.register("audits", views.AuditViewSet)

urlpatterns = [
    path("login/", views.login_view, name="api-login"),
    path("me/", views.me, name="api-me"),
    path("change-password/", views.change_password, name="api-change-password"),
    path("supplier-profile/", views.supplier_profile_view, name="supplier-profile"),
    path("company-profile/", views.company_profile_view, name="company-profile"),
    path("license/", views.license_view, name="license"),
    path("verify/<str:token>/", views.verify_certificate, name="verify-certificate"),
    path("verify-origin/<str:token>/", views.verify_solicitation_certificate, name="verify-origin"),
    path("bulk/template/", views.bulk_template, name="bulk-template"),
    path("bulk/spec/", views.bulk_spec, name="bulk-spec"),
    path("bulk/import/", views.bulk_import, name="bulk-import"),
] + router.urls
