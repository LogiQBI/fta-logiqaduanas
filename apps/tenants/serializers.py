"""Serializers del panel master (LogiQ)."""
from django.contrib.auth.models import User
from rest_framework import serializers

from apps.catalog.models import Party
from apps.tenants.models import License, Membership, Tenant, UserSecurity


class LicenseSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    plan_display = serializers.CharField(source="get_plan_display", read_only=True)
    is_valid = serializers.BooleanField(read_only=True)
    days_left = serializers.SerializerMethodField()

    class Meta:
        model = License
        fields = ["plan", "plan_display", "status", "status_display", "valid_until",
                  "renewal_amount", "renewal_currency", "renewal_notes",
                  "max_users", "max_products", "is_valid", "days_left"]

    def get_days_left(self, obj):
        if not obj.valid_until:
            return None
        from django.utils import timezone
        return (obj.valid_until - timezone.localdate()).days


class TenantSerializer(serializers.ModelSerializer):
    license = LicenseSerializer(read_only=True)
    user_count = serializers.SerializerMethodField()
    product_count = serializers.SerializerMethodField()
    party_count = serializers.SerializerMethodField()

    class Meta:
        model = Tenant
        fields = ["id", "name", "rfc", "slug", "is_active", "created_at",
                  "license", "user_count", "product_count", "party_count"]
        extra_kwargs = {"slug": {"required": False}}

    def get_user_count(self, obj):
        return obj.memberships.count()

    def get_product_count(self, obj):
        from apps.catalog.models import Product
        return Product.objects.filter(tenant=obj).count()

    def get_party_count(self, obj):
        from apps.catalog.models import Party
        return Party.objects.filter(tenant=obj).count()


class UserAdminSerializer(serializers.ModelSerializer):
    """Lista/crea usuarios con su membresía (rol + empresa + proveedor)."""
    password = serializers.CharField(write_only=True, required=False, allow_blank=True)
    tenant = serializers.PrimaryKeyRelatedField(
        queryset=Tenant.objects.all(), write_only=True, required=False, allow_null=True)
    role = serializers.ChoiceField(choices=Membership.Role.choices, write_only=True,
                                   required=False)
    party = serializers.PrimaryKeyRelatedField(
        queryset=Party.objects.all(), write_only=True, required=False, allow_null=True)
    membership = serializers.SerializerMethodField()
    is_locked = serializers.SerializerMethodField()
    must_change_password = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "email", "is_superuser", "is_active",
                  "password", "tenant", "role", "party", "membership", "is_locked",
                  "must_change_password"]

    def get_is_locked(self, obj):
        return UserSecurity.objects.filter(user=obj, is_locked=True).exists()

    def get_must_change_password(self, obj):
        """Contraseña temporal pendiente de cambio (membresía o, para masters
        sin membresía, el registro de seguridad)."""
        m = obj.memberships.first()
        if m:
            return m.must_change_password
        return UserSecurity.objects.filter(
            user=obj, must_change_password=True).exists()

    def get_membership(self, obj):
        m = obj.memberships.select_related("tenant", "party").first()
        if not m:
            return None
        return {
            "tenant": m.tenant.name, "tenant_id": m.tenant_id,
            "role": m.role, "role_display": m.get_role_display(),
            "party": (m.party.name if m.party_id else None),
        }

    def create(self, validated_data):
        password = validated_data.pop("password", None) or None
        tenant = validated_data.pop("tenant", None)
        role = validated_data.pop("role", Membership.Role.ANALYST)
        party = validated_data.pop("party", None)
        # Usuario MASTER (equipo LogiQ): superusuario sin membresía a empresas.
        is_super = bool(validated_data.get("is_superuser"))
        if is_super and not password:
            raise serializers.ValidationError(
                {"password": "Un usuario master necesita contraseña."})
        user = User(username=validated_data["username"],
                    email=validated_data.get("email", ""),
                    is_superuser=is_super, is_staff=is_super)
        if password:
            user.set_password(password)
        user.save()
        if tenant and not is_super:
            Membership.objects.create(user=user, tenant=tenant, role=role, party=party)
        return user
