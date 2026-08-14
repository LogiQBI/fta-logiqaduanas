"""Panel master (LogiQ): gestión de empresas, licencias y usuarios.
Todo aquí requiere ser superusuario (perfil master)."""
import secrets

from django.contrib.auth.models import User
from django.db import transaction
from django.utils.text import slugify
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAdminUser, IsAuthenticated
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
        """El nombre/RFC del tenant (master) es la identidad de ACCESO. La razón
        social LEGAL del certificado la captura la empresa en Datos de la empresa,
        así que aquí solo se siembra si la empresa aún no la ha llenado."""
        tenant = serializer.save()
        prof = getattr(tenant, "profile", None)
        if prof:
            changed = []
            if not prof.legal_name and tenant.name:
                prof.legal_name = tenant.name; changed.append("legal_name")
            if not prof.tax_id and tenant.rfc:
                prof.tax_id = tenant.rfc; changed.append("tax_id")
            if changed:
                prof.save(update_fields=changed + ["updated_at"])

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


# Roles que el ADMIN de una empresa puede asignar a su equipo (el rol proveedor
# se gestiona aparte, en Catálogos → Proveedores → Crear acceso).
TEAM_ROLES = [Membership.Role.ADMIN, Membership.Role.ANALYST, Membership.Role.AUDITOR]


class CompanyUserViewSet(viewsets.ViewSet):
    """Usuarios del EQUIPO de la empresa (administrador/analista/auditor),
    gestionados por el ADMINISTRADOR del tenant desde la propia empresa.
    Niveles: admin = todo + usuarios; analista = opera todo; auditor = solo lectura."""
    permission_classes = [IsAuthenticated]

    def _admin_membership(self, request):
        from apps.origin.views import active_membership
        m = active_membership(request)
        if not m or m.is_supplier:
            raise PermissionDenied("Solo usuarios de empresa pueden ver esta sección.")
        if m.role != Membership.Role.ADMIN:
            raise PermissionDenied(
                "Solo el ADMINISTRADOR de la empresa puede gestionar usuarios.")
        return m

    def _team_membership(self, m, user_id):
        """Membresía de un usuario del EQUIPO de mi tenant (nunca proveedores,
        nunca usuarios de otras empresas)."""
        return (Membership.objects.select_related("user")
                .filter(tenant=m.tenant, user_id=user_id, role__in=TEAM_ROLES)
                .exclude(user__is_superuser=True).first())

    def _row(self, mem):
        sec = UserSecurity.objects.filter(user=mem.user).first()
        return {
            "id": mem.user_id, "username": mem.user.username,
            "email": mem.user.email, "role": mem.role,
            "role_display": mem.get_role_display(),
            "is_locked": bool(sec and sec.is_locked),
            "must_change_password": mem.must_change_password,
            "created_at": mem.created_at,
        }

    def list(self, request):
        m = self._admin_membership(request)
        mems = (Membership.objects.select_related("user")
                .filter(tenant=m.tenant, role__in=TEAM_ROLES)
                .exclude(user__is_superuser=True).order_by("user__username"))
        rows = [self._row(x) for x in mems]
        # Mismo formato paginado que el resto de la API (el front usa useList).
        return Response({"results": rows, "count": len(rows)})

    def create(self, request):
        """Alta de un usuario del equipo: {username, role, email?, password?}.
        Sin password se genera una TEMPORAL; en ambos casos deberá cambiarla
        en su primer ingreso. Respeta el máximo de usuarios de la licencia."""
        m = self._admin_membership(request)
        username = (request.data.get("username") or "").strip()
        role = request.data.get("role") or Membership.Role.ANALYST
        if not username:
            return Response({"error": "Escribe el nombre de usuario."},
                            status=status.HTTP_400_BAD_REQUEST)
        if role not in TEAM_ROLES:
            return Response({"error": "Rol inválido. Usa administrador, analista o auditor."},
                            status=status.HTTP_400_BAD_REQUEST)
        if User.objects.filter(username__iexact=username).exists():
            return Response({"error": f"El usuario “{username}” ya está ocupado. Elige otro."},
                            status=status.HTTP_400_BAD_REQUEST)
        lic = getattr(m.tenant, "license", None)
        if lic and lic.max_users:
            actuales = Membership.objects.filter(
                tenant=m.tenant, role__in=TEAM_ROLES).count()
            if actuales >= lic.max_users:
                return Response(
                    {"error": f"Tu licencia permite hasta {lic.max_users} usuarios y ya "
                              f"tienes {actuales}. Contacta a LogiQ Aduanas para ampliarla."},
                    status=status.HTTP_400_BAD_REQUEST)
        password = request.data.get("password") or _temp_password()
        user = User(username=username, email=(request.data.get("email") or "").strip())
        user.set_password(password)
        user.save()
        mem = Membership.objects.create(user=user, tenant=m.tenant, role=role,
                                        must_change_password=True)
        row = self._row(mem)
        row["temp_password"] = password
        return Response(row, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="set-password")
    def set_password(self, request, pk=None):
        """Restablece la contraseña de un usuario del equipo: {password?}.
        Sin password se genera una TEMPORAL; deberá cambiarla al ingresar."""
        m = self._admin_membership(request)
        mem = self._team_membership(m, pk)
        if not mem:
            return Response({"error": "Usuario no encontrado en tu empresa."},
                            status=status.HTTP_404_NOT_FOUND)
        password = request.data.get("password") or _temp_password()
        mem.user.set_password(password)
        mem.user.save(update_fields=["password"])
        mem.must_change_password = True
        mem.save(update_fields=["must_change_password", "updated_at"])
        return Response({"username": mem.user.username, "temp_password": password})

    @action(detail=True, methods=["post"])
    def unlock(self, request, pk=None):
        m = self._admin_membership(request)
        mem = self._team_membership(m, pk)
        if not mem:
            return Response({"error": "Usuario no encontrado en tu empresa."},
                            status=status.HTTP_404_NOT_FOUND)
        sec, _ = UserSecurity.objects.get_or_create(user=mem.user)
        sec.is_locked = False
        sec.failed_attempts = 0
        sec.save(update_fields=["is_locked", "failed_attempts", "updated_at"])
        return Response({"ok": True})

    @action(detail=True, methods=["post"], url_path="set-role")
    def set_role(self, request, pk=None):
        """Cambia el nivel de un usuario del equipo: {role}."""
        m = self._admin_membership(request)
        if str(request.user.id) == str(pk) and not request.user.is_superuser:
            return Response({"error": "No puedes cambiar tu propio rol."},
                            status=status.HTTP_400_BAD_REQUEST)
        mem = self._team_membership(m, pk)
        if not mem:
            return Response({"error": "Usuario no encontrado en tu empresa."},
                            status=status.HTTP_404_NOT_FOUND)
        role = request.data.get("role")
        if role not in TEAM_ROLES:
            return Response({"error": "Rol inválido. Usa administrador, analista o auditor."},
                            status=status.HTTP_400_BAD_REQUEST)
        mem.role = role
        mem.save(update_fields=["role", "updated_at"])
        return Response(self._row(mem))

    def destroy(self, request, pk=None):
        """Elimina (quita el acceso de) un usuario del equipo."""
        m = self._admin_membership(request)
        if str(request.user.id) == str(pk):
            return Response({"error": "No puedes eliminar tu propia cuenta."},
                            status=status.HTTP_400_BAD_REQUEST)
        mem = self._team_membership(m, pk)
        if not mem:
            return Response({"error": "Usuario no encontrado en tu empresa."},
                            status=status.HTTP_404_NOT_FOUND)
        user = mem.user
        # Si solo pertenece a esta empresa se elimina la cuenta completa;
        # si tuviera otras membresías, solo se le quita el acceso a esta.
        if user.memberships.exclude(tenant=m.tenant).exists():
            mem.delete()
        else:
            user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
