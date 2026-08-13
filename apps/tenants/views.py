"""Panel master (LogiQ): gestión de empresas, licencias y usuarios.
Todo aquí requiere ser superusuario (perfil master)."""
import secrets

from django.contrib.auth.models import User
from django.db import transaction
from django.utils.text import slugify
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from apps.catalog.models import BOMComponent
from apps.origin.models import Certificate
from apps.tenants.models import License, Membership, Tenant, UserSecurity
from apps.tenants.serializers import TenantSerializer, UserAdminSerializer


def _temp_password(n=8):
    """Contraseña temporal legible (sin caracteres ambiguos)."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz"
    return "".join(secrets.choice(alphabet) for _ in range(n))


class IsMaster(IsAdminUser):
    """Solo el equipo master de LogiQ (superusuario)."""
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_superuser)


class MasterTenantViewSet(viewsets.ModelViewSet):
    queryset = Tenant.objects.select_related("license").prefetch_related("memberships").all()
    serializer_class = TenantSerializer
    permission_classes = [IsMaster]

    def perform_create(self, serializer):
        name = serializer.validated_data.get("name", "")
        if not serializer.validated_data.get("slug"):
            base = slugify(name) or "empresa"
            slug, i = base, 1
            while Tenant.objects.filter(slug=slug).exists():
                i += 1
                slug = f"{base}-{i}"
            serializer.validated_data["slug"] = slug
        tenant = serializer.save()
        # Toda empresa nueva nace con una licencia de prueba.
        License.objects.get_or_create(tenant=tenant)

    def perform_update(self, serializer):
        """Al cambiar el nombre/RFC del tenant (solo master), se sincroniza con
        los Datos de la empresa (razón social/RFC del certificado)."""
        tenant = serializer.save()
        from apps.catalog.models import CompanyProfile
        prof = getattr(tenant, "profile", None)
        if prof:
            prof.legal_name = tenant.name or prof.legal_name
            prof.tax_id = tenant.rfc or prof.tax_id
            prof.save(update_fields=["legal_name", "tax_id", "updated_at"])

    def destroy(self, request, *args, **kwargs):
        """Elimina la empresa y TODOS sus datos. Primero se borran las relaciones
        protegidas (componentes de BOM y certificados) para que la cascada del
        tenant no choque con on_delete=PROTECT."""
        tenant = self.get_object()
        with transaction.atomic():
            BOMComponent.objects.filter(tenant=tenant).delete()
            Certificate.objects.filter(tenant=tenant).delete()
            tenant.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["patch"])
    def license(self, request, pk=None):
        """Actualiza la licencia: {plan, status, valid_until, renewal_amount,
        renewal_currency, renewal_notes, max_users, max_products}."""
        tenant = self.get_object()
        lic, _ = License.objects.get_or_create(tenant=tenant)
        for field in ["plan", "status", "valid_until", "renewal_amount",
                      "renewal_currency", "renewal_notes", "max_users", "max_products"]:
            if field in request.data:
                val = request.data[field]
                # Las fechas/decimales vacíos se guardan como nulos/cero.
                if field == "valid_until" and not val:
                    val = None
                if field == "renewal_amount" and val in (None, ""):
                    val = 0
                setattr(lic, field, val)
        lic.save()
        tenant = Tenant.objects.select_related("license").get(pk=tenant.pk)
        return Response(TenantSerializer(tenant).data)


class MasterUserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.prefetch_related("memberships__tenant", "memberships__party").all()
    serializer_class = UserAdminSerializer
    permission_classes = [IsMaster]

    @action(detail=True, methods=["post"])
    def set_password(self, request, pk=None):
        """Restablece la contraseña de un usuario de CUALQUIER empresa (o master).
        Body {password?}: si no se da, se genera una TEMPORAL. En ambos casos el
        usuario deberá cambiarla en su próximo ingreso; la respuesta trae la
        contraseña para que el master se la comparta (no se vuelve a mostrar)."""
        user = self.get_object()
        pwd = request.data.get("password") or _temp_password()
        user.set_password(pwd)
        user.save(update_fields=["password"])
        Membership.objects.filter(user=user).update(must_change_password=True)
        sec, _ = UserSecurity.objects.get_or_create(user=user)
        sec.must_change_password = True
        sec.save(update_fields=["must_change_password", "updated_at"])
        return Response({"username": user.username, "temp_password": pwd})

    @action(detail=True, methods=["post"])
    def unlock(self, request, pk=None):
        """LogiQ desbloquea a un usuario (de empresa o a otro administrador)."""
        user = self.get_object()
        sec, _ = UserSecurity.objects.get_or_create(user=user)
        sec.is_locked = False
        sec.failed_attempts = 0
        sec.save(update_fields=["is_locked", "failed_attempts", "updated_at"])
        return Response({"ok": True})
