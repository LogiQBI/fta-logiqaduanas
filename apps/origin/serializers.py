from rest_framework import serializers

from apps.catalog.models import (
    BOMComponent, Party, Product, SolicitationBOM, SolicitationBOMLine,
    SolicitationRequest, SupplierDeclaration,
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
        from apps.tenants.models import UserSecurity
        locked_ids = set(UserSecurity.objects.filter(
            user__memberships__party=obj, is_locked=True).values_list("user_id", flat=True))
        return [
            {"id": m.user_id, "username": m.login_name or m.user.username,
             "must_change_password": m.must_change_password,
             "is_locked": m.user_id in locked_ids}
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


class SolicitationBOMLineSerializer(serializers.ModelSerializer):
    total = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True)

    class Meta:
        model = SolicitationBOMLine
        fields = ["id", "part_number", "description", "hs_code", "unit_price",
                  "quantity", "country", "has_origin_evidence", "total"]


class SolicitationBOMSerializer(serializers.ModelSerializer):
    lines = SolicitationBOMLineSerializer(many=True, read_only=True)
    rule_description = serializers.CharField(source="rule.description", read_only=True, default=None)
    rule_hs = serializers.CharField(source="rule.hs_pattern", read_only=True, default=None)
    rule_type = serializers.CharField(source="rule.rule_type", read_only=True, default=None)

    class Meta:
        model = SolicitationBOM
        fields = ["id", "rule", "rule_description", "rule_hs", "rule_type", "notes",
                  "lines", "origin_status", "criterion", "rvc_value", "detail",
                  "computed_at"]


class SolicitationRequestSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    period_display = serializers.CharField(source="get_period_type_display", read_only=True)
    portal_path = serializers.CharField(read_only=True)
    product_sku = serializers.CharField(source="product.sku", read_only=True)
    product_description = serializers.CharField(source="product.description", read_only=True)
    product_hs = serializers.CharField(source="product.hs_code", read_only=True)
    product_unit_cost = serializers.CharField(source="product.unit_cost", read_only=True)
    treaty_code = serializers.CharField(source="treaty.code", read_only=True)
    treaty_members = serializers.JSONField(source="treaty.member_countries", read_only=True)
    treaty_de_minimis = serializers.DecimalField(
        source="treaty.de_minimis_pct", max_digits=5, decimal_places=2, read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    submitted_bom = serializers.SerializerMethodField()

    class Meta:
        model = SolicitationRequest
        fields = "__all__"

    def get_submitted_bom(self, obj):
        bom = SolicitationBOM.objects.filter(solicitation=obj).prefetch_related("lines").first()
        return SolicitationBOMSerializer(bom).data if bom else None
