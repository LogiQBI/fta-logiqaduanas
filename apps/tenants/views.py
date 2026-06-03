"""Panel master (LogiQ): gestión de empresas, licencias y usuarios.
Todo aquí requiere ser superusuario (perfil master)."""
from django.contrib.auth.models import User
from django.db import transaction
from django.utils.text import slugify
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from apps.catalog.models import BOMComponent
from apps.origin.models import Certificate
from apps.tenants.models import License, Tenant, UserSecurity
from apps.tenants.serializers import TenantSerializer, UserAdminSerializer


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
        """Actualiza la licencia: {plan, status, valid_until, max_users, max_products}."""
        tenant = self.get_object()
        lic, _ = License.objects.get_or_create(tenant=tenant)
        for field in ["plan", "status", "valid_until", "max_users", "max_products"]:
            if field in request.data:
                setattr(lic, field, request.data[field])
        lic.save()
        return Response(TenantSerializer(tenant).data)


class MasterUserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.prefetch_related("memberships__tenant", "memberships__party").all()
    serializer_class = UserAdminSerializer
    permission_classes = [IsMaster]

    @action(detail=True, methods=["post"])
    def set_password(self, request, pk=None):
        """Restablece la contraseña de un usuario: {password}."""
        user = self.get_object()
        pwd = request.data.get("password")
        if not pwd:
            return Response({"error": "Falta 'password'."}, status=status.HTTP_400_BAD_REQUEST)
        user.set_password(pwd)
        user.save(update_fields=["password"])
        return Response({"ok": True})

    @action(detail=True, methods=["post"])
    def unlock(self, request, pk=None):
        """LogiQ desbloquea a un usuario (de empresa o a otro administrador)."""
        user = self.get_object()
        sec, _ = UserSecurity.objects.get_or_create(user=user)
        sec.is_locked = False
        sec.failed_attempts = 0
        sec.save(update_fields=["is_locked", "failed_attempts", "updated_at"])
        return Response({"ok": True})
