"""Serializers del panel master (LogiQ)."""
from django.contrib.auth.models import User
from rest_framework import serializers

from apps.catalog.models import Party
from apps.tenants.models import License, MasterScope, Membership, Tenant, UserSecurity


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
    # Master LIMITADO: solo ve/abre sus empresas asignadas (sin alta/baja de
    # empresas ni panel global de usuarios).
    is_limited_master = serializers.BooleanField(write_only=True, required=False,
                                                 default=False)
    scope_tenants = serializers.PrimaryKeyRelatedField(
        queryset=Tenant.objects.all(), many=True, write_only=True, required=False)
    master_scope = serializers.SerializerMethodField()
    temp_password = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "email", "is_superuser", "is_active",
                  "password", "tenant", "role", "party", "membership", "is_locked",
                  "must_change_password", "is_limited_master", "scope_tenants",
                  "master_scope", "temp_password"]

    def get_master_scope(self, obj):
        sc = getattr(obj, "master_scope", None)
        if not sc:
            return None
        return {"tenants": [{"id": t.id, "name": t.name} for t in sc.tenants.all()]}

    def get_temp_password(self, obj):
        # Solo presente justo después de crear (no se vuelve a mostrar).
        return getattr(obj, "_temp_password", None)

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
        limited = bool(validated_data.pop("is_limited_master", False))
        scope_tenants = validated_data.pop("scope_tenants", [])
        # Master LIMITADO (equipo LogiQ): SIN superusuario y SIN membresía; su
        # alcance son las empresas asignadas (MasterScope). Contraseña temporal
        # si no se da, y cambio obligatorio al primer ingreso.
        if limited:
            if not scope_tenants:
                raise serializers.ValidationError(
                    {"scope_tenants": "Asigna al menos una empresa al master limitado."})
            import secrets
            alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz"
            pwd = password or "".join(secrets.choice(alphabet) for _ in range(8))
            user = User(username=validated_data["username"],
                        email=validated_data.get("email", ""),
                        is_superuser=False, is_staff=False)
            user.set_password(pwd)
            user.save()
            scope = MasterScope.objects.create(user=user)
            scope.tenants.set(scope_tenants)
            sec, _ = UserSecurity.objects.get_or_create(user=user)
            sec.must_change_password = True
            sec.save(update_fields=["must_change_password", "updated_at"])
            user._temp_password = pwd
            return user
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
