from rest_framework import serializers

from apps.catalog.models import (
    BOMComponent, Party, Product, SolicitationRequest, SupplierDeclaration,
)
from apps.origin.models import Certificate, Qualification
from apps.treaties.models import OriginRule, Treaty


class TreatySerializer(serializers.ModelSerializer):
    class Meta:
        model = Treaty
        fields = "__all__"


class OriginRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = OriginRule
        fields = "__all__"


class PartySerializer(serializers.ModelSerializer):
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    # Usuarios de acceso (proveedor) ligados a esta Party.
    access_users = serializers.SerializerMethodField()

    class Meta:
        model = Party
        fields = "__all__"
        read_only_fields = ["tenant", "slug"]
        # Por defecto se da de alta un proveedor (lo fija la vista).
        extra_kwargs = {"kind": {"required": False}}

    def get_access_users(self, obj):
        return [
            {"id": m.user_id, "username": m.login_name or m.user.username,
             "must_change_password": m.must_change_password}
            for m in obj.memberships.select_related("user").all()
        ]


class ProductSerializer(serializers.ModelSerializer):
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True, default=None)
    supplier_code = serializers.CharField(source="supplier.code", read_only=True, default=None)

    class Meta:
        model = Product
        fields = "__all__"
        # El tenant lo asigna el servidor (no lo manda ni lo elige el cliente).
        read_only_fields = ["tenant"]


class BOMComponentSerializer(serializers.ModelSerializer):
    class Meta:
        model = BOMComponent
        fields = "__all__"


class SupplierDeclarationSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplierDeclaration
        fields = "__all__"


class QualificationSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = Qualification
        fields = "__all__"


class CertificateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Certificate
        fields = "__all__"


class SolicitationRequestSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    portal_path = serializers.CharField(read_only=True)

    class Meta:
        model = SolicitationRequest
        fields = "__all__"
