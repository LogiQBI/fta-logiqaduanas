"""API REST. ViewSets filtrados por los tenants del usuario (aislamiento)."""
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.catalog.models import (
    BOMComponent, Party, Product, SolicitationRequest, SupplierDeclaration,
)
from apps.catalog.services import generate_solicitations
from apps.origin import serializers as s
from apps.origin.models import Certificate, Qualification
from apps.origin.services import qualify_and_save
from apps.treaties.models import OriginRule, Treaty


class TenantScopedViewSet(viewsets.ModelViewSet):
    """Restringe los registros a los tenants donde el usuario tiene membresía."""

    def _user_tenant_ids(self):
        return self.request.user.memberships.values_list("tenant_id", flat=True)

    def get_queryset(self):
        return super().get_queryset().filter(tenant_id__in=self._user_tenant_ids())


class TreatyViewSet(viewsets.ModelViewSet):
    """Catálogo global de tratados (no está acotado por tenant)."""
    queryset = Treaty.objects.all()
    serializer_class = s.TreatySerializer


class OriginRuleViewSet(viewsets.ModelViewSet):
    queryset = OriginRule.objects.select_related("treaty").all()
    serializer_class = s.OriginRuleSerializer


class PartyViewSet(TenantScopedViewSet):
    queryset = Party.objects.all()
    serializer_class = s.PartySerializer


class ProductViewSet(TenantScopedViewSet):
    queryset = Product.objects.all()
    serializer_class = s.ProductSerializer

    @action(detail=True, methods=["post"])
    def qualify(self, request, pk=None):
        """Califica el producto contra un tratado: POST {"treaty": <id>}."""
        product = self.get_object()
        treaty_id = request.data.get("treaty")
        if not treaty_id:
            return Response({"error": "Falta 'treaty' (id del tratado)."},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            treaty = Treaty.objects.get(pk=treaty_id)
        except Treaty.DoesNotExist:
            return Response({"error": "Tratado no encontrado."},
                            status=status.HTTP_404_NOT_FOUND)
        qualification = qualify_and_save(product, treaty, user=request.user)
        return Response(s.QualificationSerializer(qualification).data)

    @action(detail=True, methods=["post"])
    def solicit(self, request, pk=None):
        """Genera solicitudes de origen a los proveedores del BOM para un tratado:
        POST {"treaty": <id>}."""
        product = self.get_object()
        treaty_id = request.data.get("treaty")
        if not treaty_id:
            return Response({"error": "Falta 'treaty' (id del tratado)."},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            treaty = Treaty.objects.get(pk=treaty_id)
        except Treaty.DoesNotExist:
            return Response({"error": "Tratado no encontrado."},
                            status=status.HTTP_404_NOT_FOUND)
        created = generate_solicitations(product, treaty)
        return Response({
            "creadas": len(created),
            "solicitudes": s.SolicitationRequestSerializer(created, many=True).data,
        })


class BOMComponentViewSet(TenantScopedViewSet):
    queryset = BOMComponent.objects.all()
    serializer_class = s.BOMComponentSerializer


class SupplierDeclarationViewSet(TenantScopedViewSet):
    queryset = SupplierDeclaration.objects.all()
    serializer_class = s.SupplierDeclarationSerializer


class QualificationViewSet(TenantScopedViewSet):
    queryset = Qualification.objects.select_related("product", "treaty").all()
    serializer_class = s.QualificationSerializer


class CertificateViewSet(TenantScopedViewSet):
    queryset = Certificate.objects.all()
    serializer_class = s.CertificateSerializer


class SolicitationRequestViewSet(TenantScopedViewSet):
    queryset = SolicitationRequest.objects.select_related(
        "product", "supplier", "treaty").all()
    serializer_class = s.SolicitationRequestSerializer
