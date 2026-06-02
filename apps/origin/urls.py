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

urlpatterns = router.urls
