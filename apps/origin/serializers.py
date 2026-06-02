from rest_framework import serializers

from apps.catalog.models import BOMComponent, Party, Product, SupplierDeclaration
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
    class Meta:
        model = Party
        fields = "__all__"


class ProductSerializer(serializers.ModelSerializer):
    class Meta:
        model = Product
        fields = "__all__"


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
