from django.urls import path
from rest_framework.authtoken.views import obtain_auth_token
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
    path("login/", obtain_auth_token, name="api-login"),
    path("me/", views.me, name="api-me"),
] + router.urls
