"""API REST con aislamiento por tenant Y por rol (empresa vs proveedor).

- Usuarios de empresa (admin/analyst/auditor): ven todo lo de su tenant.
- Usuarios proveedor (role=supplier): ven SOLO los registros de su propia Party.
"""
import logging
import secrets
import string

logger = logging.getLogger(__name__)

from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Count, ProtectedError, Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.authtoken.models import Token
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError as DRFValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from apps.catalog.models import (
    BOMComponent, CompanyProfile, HsChangeLog, Party, Product, ProductChangeLog,
    ProductOriginDocument, RuleDisplay, SolicitationBOM, SolicitationBOMLine,
    SolicitationLog, SolicitationRequest, SupplierDeclaration, SupplierProfile,
    log_product_changes,
)
from apps.catalog.uom import clean_uom
from apps.catalog.services import generate_solicitations
from apps.origin import serializers as s
from apps.origin import automotive as auto
from apps.origin import layouts as client_layouts
from apps.origin.models import (
    Audit, AuditDocument, AuditFile, AuditItem, AutomotiveAssessment, Certificate,
    ClientOriginLayout, OriginAnalysis, Qualification, SolicitationCertificate,
)
from apps.origin.services import (
    bom_lines_for, calculate_bom_origin, calculate_product_origin, certificate_elements,
    ensure_solicitation_certificate, issue_certificate, qualify_and_save,
    save_analysis_snapshot,
)
from apps.tenants.models import Membership, Tenant, UserSecurity
from apps.treaties.models import OriginRule, Treaty

MAX_LOGIN_ATTEMPTS = 5  # al 5º fallo se bloquea la cuenta


def _unlock_authority(user):
    """Quién puede desbloquear a este usuario (frase con preposición incluida)."""
    if user.is_superuser:
        return "a otro administrador de LogiQ"
    m = user.memberships.first()
    if m and m.is_supplier:
        return "a tu empresa"
    return "al administrador de LogiQ"


def _locked_message(user):
    return ("Tu cuenta está bloqueada por demasiados intentos fallidos. "
            f"Pide {_unlock_authority(user)} que la desbloquee.")


def _log_sol(sr, action, detail="", user=None):
    SolicitationLog.objects.create(tenant=sr.tenant, solicitation=sr,
                                   action=action, detail=detail, user=user)


def _temp_password(n=8):
    """Contraseña temporal legible (sin caracteres ambiguos)."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz"
    return "".join(secrets.choice(alphabet) for _ in range(n))


def _unique_username(tenant_slug, party_slug, login_name):
    """Username interno namespaceado y único globalmente.
    Permite que dos empresas tengan el mismo proveedor con el mismo login_name."""
    from django.utils.text import slugify
    base = f"{tenant_slug}__{party_slug}__{slugify(login_name) or 'user'}"
    candidate, i = base, 1
    while User.objects.filter(username=candidate).exists():
        i += 1
        candidate = f"{base}-{i}"
    return candidate


def _party_users(party):
    """Lista de usuarios de acceso de un proveedor (muestra el nombre que escriben)."""
    locked_ids = set(UserSecurity.objects.filter(
        user__memberships__party=party, is_locked=True).values_list("user_id", flat=True))
    return [
        {"id": m.user_id, "username": m.login_name or m.user.username,
         "must_change_password": m.must_change_password,
         "is_locked": m.user_id in locked_ids}
        for m in party.memberships.select_related("user").all()
    ]


class CatalogPagination(PageNumberPagination):
    """Catálogos (productos, proveedores, etc.): el front filtra/exporta del lado
    del cliente, así que devolvemos TODO en una sola página (hasta 10 000). Evita
    que solo se vean los primeros 50 cuando hay cientos de números de parte."""
    page_size = 10000
    page_size_query_param = "page_size"
    max_page_size = 10000


def active_membership(request):
    """Membresía efectiva del request.

    Para el equipo LogiQ (superusuario) que "abre" una empresa con el header
    `X-As-Tenant: <id>`, devuelve una membresía SINTÉTICA de administrador de ese
    tenant (objeto en memoria, NO se guarda en BD). Así el master ve el sistema de
    esa empresa como admin sin un login aparte. Para usuarios normales devuelve su
    membresía real (comportamiento sin cambios)."""
    user = getattr(request, "user", None)
    if not user or not user.is_authenticated:
        return None
    if user.is_superuser:
        tid = request.headers.get("X-As-Tenant")
        if tid:
            t = Tenant.objects.filter(pk=tid).first()
            if t:
                return Membership(user=user, tenant=t,
                                  role=Membership.Role.ADMIN, party=None)
        return None
    return user.memberships.select_related("party", "tenant").first()


def is_impersonating(request):
    """True si un master está viendo una empresa vía X-As-Tenant."""
    user = getattr(request, "user", None)
    return bool(user and user.is_superuser and request.headers.get("X-As-Tenant"))


READ_ONLY_ROLE_MSG = ("Tu perfil de AUDITOR es de solo lectura: puedes consultar "
                      "toda la información, pero no crearla ni modificarla.")


def forbid_read_only(m, request):
    """El rol AUDITOR de la empresa es de SOLO LECTURA: bloquea cualquier
    método que no sea de consulta. No aplica a proveedores (tienen su flujo)."""
    if (m and not m.is_supplier and m.role == Membership.Role.AUDITOR
            and request.method not in ("GET", "HEAD", "OPTIONS")):
        raise PermissionDenied(READ_ONLY_ROLE_MSG)


class TenantScopedViewSet(viewsets.ModelViewSet):
    """Acota por tenant y, si el usuario es proveedor, por su Party.

    `supplier_field`: nombre del campo que liga el modelo con la Party del
    proveedor. Si es None, los usuarios proveedor NO ven nada de este modelo.
    """

    supplier_field = None
    pagination_class = CatalogPagination

    def membership(self):
        return active_membership(self.request)

    def initial(self, request, *args, **kwargs):
        # Guardia central de roles: el AUDITOR no escribe en ningún recurso.
        super().initial(request, *args, **kwargs)
        forbid_read_only(self.membership(), request)

    def get_queryset(self):
        qs = super().get_queryset()
        m = self.membership()
        if not m:
            return qs.none()
        qs = qs.filter(tenant_id=m.tenant_id)
        if m.is_supplier:
            if self.supplier_field and m.party_id:
                return qs.filter(**{self.supplier_field: m.party_id})
            return qs.none()
        return qs


class TreatyViewSet(viewsets.ReadOnlyModelViewSet):
    """Catálogo global de tratados (referencia, solo lectura para todos)."""
    queryset = Treaty.objects.all()
    serializer_class = s.TreatySerializer


class RulesPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"  # ?page_size=100 ; "Todo" -> grande
    max_page_size = 5000


class OriginRuleViewSet(viewsets.ModelViewSet):
    """Catálogo de PSR. Lectura para todos; crear/editar/borrar SOLO el master.
    Cada empresa puede sobrescribir COMO SE MUESTRA un PSR (cosmético)."""
    queryset = OriginRule.objects.select_related("treaty").all()
    serializer_class = s.OriginRuleSerializer
    pagination_class = RulesPagination

    def _membership(self):
        return active_membership(self.request)

    def _require_master(self):
        if not self.request.user.is_superuser:
            raise PermissionDenied("Solo el administrador (LogiQ) edita el catálogo de reglas.")

    def perform_create(self, serializer):
        self._require_master(); serializer.save()

    def perform_update(self, serializer):
        self._require_master(); serializer.save()

    def perform_destroy(self, instance):
        self._require_master(); instance.delete()

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        # Override cosmético del tenant que consulta (para mostrar su etiqueta).
        m = self._membership()
        if m and not self.request.user.is_superuser:
            ctx["rule_overrides"] = {
                d.rule_id: d for d in RuleDisplay.objects.filter(tenant=m.tenant)}
        return ctx

    def get_queryset(self):
        qs = super().get_queryset()
        digits = lambda x: "".join(c for c in (x or "") if c.isdigit())
        treaty = self.request.query_params.get("treaty")
        hs = self.request.query_params.get("hs")          # PSR aplicables a una fracción
        q = self.request.query_params.get("q")            # buscar por fracción (prefijo)
        if treaty:
            qs = qs.filter(treaty_id=treaty)
        if q:
            qs = qs.filter(hs_pattern__startswith=digits(q))
        if hs:
            hsd = digits(hs)
            ids = [r.id for r in qs if hsd.startswith(digits(r.hs_pattern))]
            qs = qs.filter(id__in=ids)
        return qs.order_by("hs_pattern")

    @action(detail=True, methods=["post"], url_path="set-display")
    def set_display(self, request, pk=None):
        """La empresa fija cómo se muestra este PSR (cosmético). Body:
        {display_type, display_description}. No cambia el cálculo."""
        m = self._membership()
        if not m or m.is_supplier:
            raise PermissionDenied("Solo usuarios de empresa pueden personalizar la presentación.")
        rule = self.get_object()
        disp, _ = RuleDisplay.objects.get_or_create(tenant=m.tenant, rule=rule)
        disp.display_type = (request.data.get("display_type") or "").strip()[:60]
        disp.display_description = (request.data.get("display_description") or "").strip()[:255]
        disp.save()
        return Response(s.OriginRuleSerializer(rule, context=self.get_serializer_context()).data)

    @action(detail=True, methods=["post"], url_path="reset-display")
    def reset_display(self, request, pk=None):
        """La empresa restablece la presentación oficial (borra su override)."""
        m = self._membership()
        if not m or m.is_supplier:
            raise PermissionDenied("Solo usuarios de empresa pueden personalizar la presentación.")
        RuleDisplay.objects.filter(tenant=m.tenant, rule_id=pk).delete()
        return Response(s.OriginRuleSerializer(self.get_object(), context=self.get_serializer_context()).data)


class PartyViewSet(TenantScopedViewSet):
    queryset = Party.objects.all()
    serializer_class = s.PartySerializer
    supplier_field = "id"  # el proveedor solo se ve a sí mismo

    def get_queryset(self):
        qs = super().get_queryset()
        kind = self.request.query_params.get("kind")  # 'supplier' | 'customer'
        if kind:
            qs = qs.filter(kind=kind)
        return qs

    def _require_company(self):
        m = self.membership()
        if not m or m.is_supplier:
            raise PermissionDenied("Solo usuarios de empresa pueden gestionar el catálogo.")
        return m

    def perform_create(self, serializer):
        m = self._require_company()
        # Por defecto se da de alta un proveedor.
        kind = serializer.validated_data.get("kind") or Party.Kind.SUPPLIER
        serializer.save(tenant=m.tenant, kind=kind)

    def perform_update(self, serializer):
        self._require_company()
        serializer.save()

    def destroy(self, request, *args, **kwargs):
        self._require_company()
        party = self.get_object()
        try:
            with transaction.atomic():
                party.delete()
        except ProtectedError:
            return Response(
                {"error": "No se puede borrar: este proveedor tiene registros "
                          "relacionados (insumos o solicitudes). Quítalos primero."},
                status=status.HTTP_409_CONFLICT)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["get", "post"], url_path="users")
    def users(self, request, pk=None):
        """GET: lista los usuarios de acceso del proveedor.
        POST: agrega uno. Body {username, password?}. Si no se da contraseña,
        se genera una TEMPORAL y el usuario deberá cambiarla en su primer ingreso."""
        m = self._require_company()
        party = self.get_object()
        if request.method == "GET":
            return Response(_party_users(party))

        login_name = (request.data.get("username") or "").strip()
        if not login_name:
            return Response({"error": "Falta el usuario."}, status=status.HTTP_400_BAD_REQUEST)
        # Único DENTRO de este proveedor (no global).
        if party.memberships.filter(
                Q(login_name__iexact=login_name) | Q(user__username=login_name)).exists():
            return Response({"error": f"Este proveedor ya tiene un usuario “{login_name}”."},
                            status=status.HTTP_400_BAD_REQUEST)
        password = request.data.get("password") or _temp_password()
        username = _unique_username(m.tenant.slug, party.slug, login_name)
        user = User(username=username)
        user.set_password(password)
        user.save()
        Membership.objects.create(
            user=user, tenant=m.tenant, role=Membership.Role.SUPPLIER,
            party=party, login_name=login_name, must_change_password=True)
        return Response({"id": user.id, "username": login_name, "temp_password": password},
                        status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path=r"users/(?P<user_id>[0-9]+)/reset-password")
    def reset_password(self, request, pk=None, user_id=None):
        """Restablece (recupera) la contraseña de un usuario del proveedor.
        Body {password?}. Si no se da, se genera una TEMPORAL. El usuario deberá
        cambiarla en su próximo ingreso."""
        m = self._require_company()
        party = self.get_object()
        mem = party.memberships.filter(user_id=user_id, tenant=m.tenant).select_related("user").first()
        if not mem:
            return Response({"error": "Usuario no encontrado para este proveedor."},
                            status=status.HTTP_404_NOT_FOUND)
        password = request.data.get("password") or _temp_password()
        mem.user.set_password(password)
        mem.user.save(update_fields=["password"])
        mem.must_change_password = True
        mem.save(update_fields=["must_change_password", "updated_at"])
        return Response({"username": mem.user.username, "temp_password": password})

    @action(detail=True, methods=["delete"], url_path=r"users/(?P<user_id>[0-9]+)")
    def remove_user(self, request, pk=None, user_id=None):
        """Quita (elimina) un usuario de acceso del proveedor."""
        m = self._require_company()
        party = self.get_object()
        mem = party.memberships.filter(user_id=user_id, tenant=m.tenant).select_related("user").first()
        if not mem:
            return Response({"error": "Usuario no encontrado para este proveedor."},
                            status=status.HTTP_404_NOT_FOUND)
        mem.user.delete()  # borra también su membresía (cascade)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"], url_path=r"users/(?P<user_id>[0-9]+)/unlock")
    def unlock_user(self, request, pk=None, user_id=None):
        """La empresa desbloquea a un usuario de su proveedor."""
        m = self._require_company()
        party = self.get_object()
        mem = party.memberships.filter(user_id=user_id, tenant=m.tenant).first()
        if not mem:
            return Response({"error": "Usuario no encontrado para este proveedor."},
                            status=status.HTTP_404_NOT_FOUND)
        sec, _ = UserSecurity.objects.get_or_create(user_id=user_id)
        sec.is_locked = False
        sec.failed_attempts = 0
        sec.save(update_fields=["is_locked", "failed_attempts", "updated_at"])
        return Response({"ok": True})


class ProductViewSet(TenantScopedViewSet):
    queryset = Product.objects.all()
    serializer_class = s.ProductSerializer
    supplier_field = "supplier_id"  # productos que ese proveedor surte

    def get_queryset(self):
        # Cuenta de cambios de precio/origen para el badge "historial" en la lista.
        return super().get_queryset().prefetch_related("customers").annotate(
            _change_log_count=Count("change_logs", distinct=True))

    def perform_create(self, serializer):
        """El alta de productos es solo para usuarios de empresa.
        El tenant se toma de la membresía (no se confía en el cliente)."""
        m = self.membership()
        if not m or m.is_supplier:
            raise PermissionDenied("Solo usuarios de empresa pueden crear productos.")
        # El SKU es único por tenant: avisar con un 400 claro en vez de un 500
        # (IntegrityError) si el número de parte ya existe.
        sku = (serializer.validated_data.get("sku") or "").strip().upper()
        if sku and Product.objects.filter(tenant=m.tenant, sku=sku).exists():
            raise DRFValidationError(
                {"sku": f"Ya existe un número de parte con SKU “{sku}”. "
                        f"Usa otro o edita el existente."})
        serializer.save(tenant=m.tenant)

    def perform_update(self, serializer):
        m = self.membership()
        if not m or m.is_supplier:
            raise PermissionDenied("Solo usuarios de empresa pueden editar productos.")
        product = serializer.instance
        before = {"unit_cost": product.unit_cost, "currency": product.currency,
                  "country_of_origin": product.country_of_origin}
        obj = serializer.save()
        log_product_changes(
            product=obj, before=before,
            after={"unit_cost": obj.unit_cost, "currency": obj.currency,
                   "country_of_origin": obj.country_of_origin},
            source=ProductChangeLog.Source.MANUAL, user=self.request.user)

    def destroy(self, request, *args, **kwargs):
        m = self.membership()
        if not m or m.is_supplier:
            raise PermissionDenied("Solo usuarios de empresa pueden borrar productos.")
        product = self.get_object()
        try:
            with transaction.atomic():
                product.delete()
        except ProtectedError:
            return Response(
                {"error": "No se puede borrar: este producto se usa como componente "
                          "en la lista de materiales de otro producto, o tiene un "
                          "certificado emitido. Quítalo de ahí primero."},
                status=status.HTTP_409_CONFLICT)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"], url_path="set-country")
    def set_country(self, request, pk=None):
        """El PROVEEDOR define el país de origen del producto que surte."""
        m = self.membership()
        if not m or not m.is_supplier:
            raise PermissionDenied("Solo el proveedor puede definir el país de origen.")
        product = self.get_object()  # acotado a productos de su Party
        old_country = product.country_of_origin
        product.country_of_origin = (request.data.get("country_of_origin") or "").strip().upper()[:2]
        product.save(update_fields=["country_of_origin", "updated_at"])
        log_product_changes(
            product=product,
            before={"country_of_origin": old_country},
            after={"country_of_origin": product.country_of_origin},
            source=ProductChangeLog.Source.SUPPLIER, user=request.user)
        return Response(s.ProductSerializer(product).data)

    @action(detail=True, methods=["get", "post"], url_path="origin-docs")
    def origin_docs(self, request, pk=None):
        """Certificados de origen (PDF) que la EMPRESA ya tiene de este insumo,
        subidos sin pasar por el portal del proveedor.
        GET: lista. POST: {filename, data_b64, content_type?, supplier?, treaty?,
        valid_from?, valid_to?, notes?, register_declaration?, is_originating?,
        country_of_origin?}. Con register_declaration=true además registra la
        declaración de origen (requiere tratado, vigencia y proveedor) para que
        el cálculo de origen la tome como si la hubiera respondido el proveedor."""
        m = self.membership()
        if not m or m.is_supplier:
            raise PermissionDenied("Solo usuarios de empresa pueden gestionar estos documentos.")
        product = self.get_object()
        if request.method == "GET":
            docs = product.origin_documents.select_related("supplier", "treaty", "uploaded_by")
            rows = s.ProductOriginDocumentSerializer(docs, many=True).data
            # Mismo formato paginado que el resto de la API (el front usa useList).
            return Response({"results": rows, "count": len(rows)})

        data_b64 = request.data.get("data_b64") or ""
        filename = (request.data.get("filename") or "certificado.pdf").strip()[:200]
        if not data_b64:
            return Response({"error": "Adjunta el archivo."}, status=status.HTTP_400_BAD_REQUEST)
        if len(data_b64) > 14_000_000:  # ~10 MB reales
            return Response({"error": "El archivo es muy grande (máximo ~10 MB)."},
                            status=status.HTTP_400_BAD_REQUEST)
        import base64
        try:
            size = len(base64.b64decode(data_b64))
        except Exception:
            return Response({"error": "El archivo no se pudo leer (base64 inválido)."},
                            status=status.HTTP_400_BAD_REQUEST)

        supplier = None
        if request.data.get("supplier"):
            supplier = Party.objects.filter(tenant=m.tenant, pk=request.data["supplier"],
                                            kind=Party.Kind.SUPPLIER).first()
        supplier = supplier or product.supplier
        treaty = None
        if request.data.get("treaty"):
            treaty = Treaty.objects.filter(pk=request.data["treaty"]).first()
        valid_from = request.data.get("valid_from") or None
        valid_to = request.data.get("valid_to") or None

        declaration = None
        if request.data.get("register_declaration"):
            faltan = []
            if not treaty:
                faltan.append("tratado")
            if not (valid_from and valid_to):
                faltan.append("vigencia (desde/hasta)")
            if not supplier:
                faltan.append("proveedor (asigna uno al insumo o elígelo aquí)")
            if faltan:
                return Response(
                    {"error": "Para registrar la declaración de origen falta: "
                              + ", ".join(faltan) + "."},
                    status=status.HTTP_400_BAD_REQUEST)
            declaration = SupplierDeclaration.objects.create(
                tenant=m.tenant, supplier=supplier, product=product, treaty=treaty,
                is_originating=bool(request.data.get("is_originating", True)),
                country_of_origin=(request.data.get("country_of_origin") or "").strip().upper()[:2],
                valid_from=valid_from, valid_to=valid_to)

        doc = ProductOriginDocument.objects.create(
            tenant=m.tenant, product=product, supplier=supplier, treaty=treaty,
            declaration=declaration, filename=filename,
            content_type=(request.data.get("content_type") or "application/pdf")[:120],
            size=size, data_b64=data_b64, valid_from=valid_from, valid_to=valid_to,
            notes=(request.data.get("notes") or "")[:255], uploaded_by=request.user)
        return Response(s.ProductOriginDocumentSerializer(doc).data,
                        status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"], url_path="origin-docs/(?P<doc_id>[0-9]+)/download")
    def download_origin_doc(self, request, pk=None, doc_id=None):
        """Descarga el certificado adjunto."""
        import base64
        from django.http import HttpResponse
        m = self.membership()
        if not m or m.is_supplier:
            raise PermissionDenied("Solo usuarios de empresa pueden descargar estos documentos.")
        product = self.get_object()
        doc = product.origin_documents.filter(pk=doc_id).first()
        if not doc:
            return Response({"error": "Documento no encontrado."},
                            status=status.HTTP_404_NOT_FOUND)
        resp = HttpResponse(base64.b64decode(doc.data_b64),
                            content_type=doc.content_type or "application/pdf")
        resp["Content-Disposition"] = f'attachment; filename="{doc.filename}"'
        return resp

    @action(detail=True, methods=["post"], url_path="origin-docs/(?P<doc_id>[0-9]+)/delete")
    def delete_origin_doc(self, request, pk=None, doc_id=None):
        """Elimina el certificado adjunto (y, si se creó junto con él, su
        declaración de origen ligada)."""
        m = self.membership()
        if not m or m.is_supplier:
            raise PermissionDenied("Solo usuarios de empresa pueden borrar estos documentos.")
        product = self.get_object()
        doc = product.origin_documents.filter(pk=doc_id).first()
        if not doc:
            return Response({"error": "Documento no encontrado."},
                            status=status.HTTP_404_NOT_FOUND)
        if doc.declaration_id:
            SupplierDeclaration.objects.filter(pk=doc.declaration_id).delete()
        doc.delete()
        return Response({"ok": True})

    @action(detail=True, methods=["get"], url_path="history")
    def history(self, request, pk=None):
        """Histórico de cambios de precio y país de origen del número de parte.
        Disponible tanto para la empresa como para el proveedor (acotado por
        get_object al alcance del usuario)."""
        product = self.get_object()
        logs = product.change_logs.select_related("changed_by").all()[:200]
        data = [{
            "kind": l.kind, "kind_display": l.get_kind_display(),
            "old_value": l.old_value, "new_value": l.new_value,
            "old_price": str(l.old_price) if l.old_price is not None else None,
            "new_price": str(l.new_price) if l.new_price is not None else None,
            "currency": l.currency,
            "source": l.source, "source_display": l.get_source_display(),
            "changed_by": l.changed_by.username if l.changed_by_id else None,
            "created_at": l.created_at,
        } for l in logs]
        return Response(data)

    @action(detail=True, methods=["post"], url_path="suggest-hs")
    def suggest_hs(self, request, pk=None):
        """El PROVEEDOR sugiere corregir la fracción del producto.
        Body: {hs_suggested, note}. Queda pendiente de que la empresa resuelva."""
        m = self.membership()
        if not m or not m.is_supplier:
            raise PermissionDenied("Solo el proveedor puede sugerir la fracción.")
        product = self.get_object()  # ya acotado a productos de su Party
        hs = "".join(c for c in (request.data.get("hs_suggested") or "") if c.isdigit())[:6]
        if len(hs) < 6:
            return Response({"error": "La fracción sugerida debe tener 6 dígitos."},
                            status=status.HTTP_400_BAD_REQUEST)
        product.hs_suggested = hs
        product.hs_suggestion_status = Product.HsSuggestion.PENDING
        product.hs_suggestion_note = (request.data.get("note") or "")[:255]
        product.hs_suggested_by = m.party
        product.save(update_fields=["hs_suggested", "hs_suggestion_status",
                                    "hs_suggestion_note", "hs_suggested_by", "updated_at"])
        return Response(s.ProductSerializer(product).data)

    @action(detail=True, methods=["post"], url_path="resolve-hs")
    def resolve_hs(self, request, pk=None):
        """La EMPRESA acepta o rechaza la fracción sugerida por el proveedor.
        Body: {action: "accept"|"reject"}. Registra el cambio en la bitácora."""
        m = self.membership()
        if not m or m.is_supplier:
            raise PermissionDenied("Solo la empresa puede aceptar/rechazar la fracción.")
        product = self.get_object()
        if product.hs_suggestion_status != Product.HsSuggestion.PENDING:
            return Response({"error": "No hay una sugerencia pendiente."},
                            status=status.HTTP_400_BAD_REQUEST)
        accion = request.data.get("action")
        if accion not in ("accept", "reject"):
            return Response({"error": "Acción inválida."}, status=status.HTTP_400_BAD_REQUEST)
        HsChangeLog.objects.create(
            tenant=m.tenant, product=product,
            old_hs=product.hs_code, new_hs=product.hs_suggested,
            suggested_by=product.hs_suggested_by.name if product.hs_suggested_by_id else "",
            action="accepted" if accion == "accept" else "rejected",
            note=product.hs_suggestion_note, decided_by=request.user)
        if accion == "accept":
            product.hs_code = product.hs_suggested
        # En ambos casos se cierra la sugerencia.
        product.hs_suggested = ""
        product.hs_suggestion_status = ""
        product.hs_suggestion_note = ""
        product.hs_suggested_by = None
        product.save(update_fields=["hs_code", "hs_suggested", "hs_suggestion_status",
                                    "hs_suggestion_note", "hs_suggested_by", "updated_at"])
        return Response(s.ProductSerializer(product).data)

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

    @action(detail=True, methods=["get"], url_path="bom-origin")
    def bom_origin(self, request, pk=None):
        """Devuelve el BOM del producto y, por cada insumo, las declaraciones de
        proveedor disponibles para el tratado (para el toggle de la empresa)."""
        m = self.membership()
        if not m or m.is_supplier:
            raise PermissionDenied("Solo la empresa puede ver el cálculo de origen.")
        from decimal import Decimal
        from apps.origin import engine
        from apps.origin.services import _resolve_component_origin
        product = self.get_object()
        treaty_id = request.query_params.get("treaty")
        treaty = Treaty.objects.filter(pk=treaty_id).first() if treaty_id else None
        # Regla de origen sugerida (PSR) para la fracción del producto terminado.
        suggested_rule = None
        if treaty:
            r = engine.find_rule(treaty, product.hs_code or "")
            if r:
                suggested_rule = {"id": r.id, "hs_pattern": r.hs_pattern,
                                  "rule_type": r.rule_type, "description": r.description}
        # El régimen automotriz de 'core parts' es exclusivo del T-MEC.
        core_code = (engine.core_part_code(product.hs_code or "")
                     if (treaty and engine.is_tmec(treaty)) else None)
        comps = []
        total = Decimal("0")
        vnm = Decimal("0")   # valor de materiales NO originarios (automático, por tratado)
        for bc in product.bom_components.select_related("component", "component__supplier").all():
            decls = []
            if treaty_id:
                qs = SupplierDeclaration.objects.filter(
                    product=bc.component, treaty_id=treaty_id).order_by("-valid_from")
                decls = [{"valid_from": d.valid_from, "valid_to": d.valid_to,
                          "is_originating": d.is_originating,
                          "country": d.country_of_origin} for d in qs]
            originating = None
            if treaty:
                info = _resolve_component_origin(bc, treaty, None, set())
                total += info["value"]
                if not info["originating"]:
                    vnm += info["value"]
                originating = info["originating"]
            comps.append({**s.BOMComponentSerializer(bc).data, "declarations": decls,
                          "originating": originating})
        conversion = Decimal(str(product.conversion_cost or 0))
        net_cost = total + conversion
        return Response({"product": s.ProductSerializer(product).data, "components": comps,
                         "treaty_members": (treaty.member_countries if treaty else []),
                         "total_value": str(total), "conversion_cost": str(conversion),
                         "net_cost": str(net_cost), "vnm": str(vnm),
                         "suggested_rule": suggested_rule, "automotive_core_code": core_code})

    @action(detail=False, methods=["post"], url_path="supercore")
    def supercore(self, request):
        """Cálculo SÚPER-CORE (T-MEC, Apéndice automotriz Art. 3.9): trata las
        partes esenciales (core, Tabla A.1) del catálogo como UNA sola parte y
        evalúa el VCR combinado por costo neto (con phase-in).
        Body: {treaty, as_of?, products?: [ids]} — sin `products` toma TODAS las
        partes core activas del catálogo. El costo neto y el VNM de cada parte
        salen de su BOM (mismo criterio que el cálculo de origen)."""
        from decimal import Decimal
        from django.utils.dateparse import parse_date
        from apps.origin import engine
        from apps.origin.services import _resolve_component_origin
        m = self.membership()
        if not m or m.is_supplier:
            raise PermissionDenied("Solo la empresa puede calcular el súper-core.")
        treaty = Treaty.objects.filter(pk=request.data.get("treaty")).first()
        if not treaty or not engine.is_tmec(treaty):
            return Response({"error": "El súper-core es exclusivo del T-MEC/USMCA."},
                            status=status.HTTP_400_BAD_REQUEST)
        as_of = parse_date(request.data.get("as_of") or "") or None
        ids = request.data.get("products") or []
        qs = Product.objects.filter(tenant_id=m.tenant_id, is_active=True)
        if ids:
            qs = qs.filter(id__in=ids)
        parts = []
        for p in qs.prefetch_related("bom_components__component__supplier"):
            code = engine.core_part_code(p.hs_code or "")
            if not code:
                continue
            total, vnm, has_bom = Decimal("0"), Decimal("0"), False
            for bc in p.bom_components.all():
                has_bom = True
                info = _resolve_component_origin(bc, treaty, None, set())
                total += info["value"]
                if not info["originating"]:
                    vnm += info["value"]
            net_cost = total + Decimal(str(p.conversion_cost or 0))
            parts.append({"id": p.id, "sku": p.sku, "description": p.description,
                          "hs_code": p.hs_code, "core_code": code,
                          "net_cost": net_cost, "vnm": vnm,
                          "has_data": has_bom and net_cost > 0})
        if not parts:
            return Response({"error": "No hay partes esenciales (core, Tabla A.1) en la "
                             "selección: ninguna fracción del catálogo coincide."},
                            status=status.HTTP_400_BAD_REQUEST)
        return Response(auto.evaluate_supercore(parts, as_of))

    @action(detail=True, methods=["get"], url_path="automotive")
    def automotive_get(self, request, pk=None):
        """Devuelve la evaluación automotriz guardada del producto (si existe)."""
        m = self.membership()
        if not m or m.is_supplier:
            raise PermissionDenied("Solo la empresa puede ver el régimen automotriz.")
        product = self.get_object()
        treaty_id = request.query_params.get("treaty")
        a = AutomotiveAssessment.objects.filter(
            tenant=m.tenant, product=product, treaty_id=treaty_id).first() if treaty_id else None
        return Response(s.AutomotiveAssessmentSerializer(a).data if a else {})

    @action(detail=True, methods=["post"], url_path="calc-automotive")
    def calc_automotive(self, request, pk=None):
        """Evalúa el régimen automotriz T-MEC y guarda el resultado.
        Body: {treaty, vehicle_class, as_of, net_cost, vnm, lvc_pct, wage_usd_h,
        steel_na_pct, aluminum_na_pct, core_parts_originating}."""
        from django.utils.dateparse import parse_date
        m = self.membership()
        if not m or m.is_supplier:
            raise PermissionDenied("Solo la empresa puede calcular el régimen automotriz.")
        product = self.get_object()
        treaty = Treaty.objects.filter(pk=request.data.get("treaty")).first()
        if not treaty:
            return Response({"error": "Falta el tratado o no existe."},
                            status=status.HTTP_400_BAD_REQUEST)
        d = request.data
        vclass = d.get("vehicle_class") or "passenger"
        if vclass not in auto.CLASSES:
            return Response({"error": "Clase de vehículo inválida."},
                            status=status.HTTP_400_BAD_REQUEST)
        as_of = parse_date(d.get("as_of") or "") or None
        core = bool(d.get("core_parts_originating"))
        result = auto.evaluate(
            vehicle_class=vclass, as_of=as_of,
            net_cost=d.get("net_cost"), vnm=d.get("vnm"), lvc_pct=d.get("lvc_pct"),
            wage_usd_h=d.get("wage_usd_h"), steel_na_pct=d.get("steel_na_pct"),
            aluminum_na_pct=d.get("aluminum_na_pct"), core_parts_originating=core,
            rvc_method=(d.get("rvc_method") or "net_cost"),
            transaction_value=d.get("transaction_value"), lvc_value=d.get("lvc_value"))
        AutomotiveAssessment.objects.update_or_create(
            tenant=m.tenant, product=product, treaty=treaty,
            defaults={"vehicle_class": vclass, "as_of": as_of,
                      "net_cost": d.get("net_cost") or 0, "vnm": d.get("vnm") or 0,
                      "lvc_pct": d.get("lvc_pct") or 0, "wage_usd_h": d.get("wage_usd_h") or 0,
                      "lvc_value": d.get("lvc_value") or 0,
                      "steel_na_pct": d.get("steel_na_pct") or 0,
                      "aluminum_na_pct": d.get("aluminum_na_pct") or 0,
                      "core_parts_originating": core, "qualifies": result["qualifies"],
                      "detail": result, "computed_by": request.user})
        # La evaluación automotriz ES la determinación de origen para core parts:
        # actualiza la calificación (sale de AUTO_REVIEW) para que pueda certificarse.
        Qualification.objects.update_or_create(
            tenant=m.tenant, product=product, treaty=treaty,
            defaults={"status": ("QUALIFIES" if result["qualifies"] else "DOES_NOT"),
                      "criterion": "Automotriz (T-MEC)",
                      "rvc_value": (result.get("rvc_value") or None),
                      "detail": {"automotive": result}, "computed_by": request.user})
        # Snapshot en el histórico de análisis (con la fecha de esta corrida).
        # Incluye el desglose del BOM usado (insumos, proveedor, origen) para que el
        # PDF muestre el sustento del cálculo, igual que el cálculo por BOM.
        # El snapshot es AUXILIAR: si algo falla aquí, no debe tumbar el cálculo.
        try:
            from decimal import Decimal as _Dec
            from apps.origin import engine as _engine
            lines, materials_total, bom_vnm = bom_lines_for(product, treaty, as_of)
            conversion = _Dec(str(product.conversion_cost or 0))
            net_cost = _Dec(str(d.get("net_cost"))) if d.get("net_cost") not in (None, "") else (materials_total + conversion)
            _r = _engine.find_rule(treaty, product.hs_code or "")
            psr = ({"hs_pattern": _r.hs_pattern, "rule_type": _r.rule_type,
                    "description": _r.description} if _r else None)
            snap = {"status": ("QUALIFIES" if result["qualifies"] else "DOES_NOT"),
                    "criterion": "Automotriz (T-MEC)", "rvc_value": result.get("rvc_value"),
                    "detail": {**result, "bom": lines, "materials_total": str(materials_total),
                               "conversion_cost": str(conversion), "total_value": str(net_cost),
                               "vnm": str(d.get("vnm") if d.get("vnm") not in (None, "") else bom_vnm),
                               "psr": psr}}
            save_analysis_snapshot(product, treaty, OriginAnalysis.Kind.AUTOMOTIVE, snap, request.user)
        except Exception:
            logger.exception("No se pudo guardar el snapshot del análisis automotriz "
                             "(product=%s, treaty=%s)", product.pk, treaty.pk)
        return Response(result)

    @action(detail=True, methods=["post"], url_path="calc-bom-origin")
    def calc_bom_origin(self, request, pk=None):
        """Calcula el origen del producto a partir de SU BOM, para un tratado.
        Body: {treaty, as_of?}. Guarda la Qualification y devuelve la traza."""
        m = self.membership()
        if not m or m.is_supplier:
            raise PermissionDenied("Solo la empresa puede calcular el origen.")
        product = self.get_object()
        treaty = Treaty.objects.filter(pk=request.data.get("treaty")).first()
        if not treaty:
            return Response({"error": "Falta el tratado o no existe."},
                            status=status.HTTP_400_BAD_REQUEST)
        from django.utils.dateparse import parse_date
        raw = request.data.get("as_of")
        as_of = parse_date(raw) if raw else None
        result = calculate_product_origin(product, treaty, as_of=as_of, user=request.user)
        return Response(result)


class BOMComponentViewSet(TenantScopedViewSet):
    """Lista de materiales (BOM) de los productos de la EMPRESA. Solo la empresa
    la gestiona; los proveedores no la ven (supplier_field = None)."""
    queryset = BOMComponent.objects.all()
    serializer_class = s.BOMComponentSerializer

    def get_queryset(self):
        qs = super().get_queryset().select_related("component", "component__supplier")
        parent = self.request.query_params.get("parent")
        if parent:
            qs = qs.filter(parent_id=parent)
        # Orden estable por número de parte del insumo (antes salía por id de alta).
        return qs.order_by("component__sku", "id")

    def _require_company(self):
        m = self.membership()
        if not m or m.is_supplier:
            raise PermissionDenied("Solo la empresa puede gestionar la lista de materiales.")
        return m

    def perform_create(self, serializer):
        m = self._require_company()
        serializer.save(tenant=m.tenant)

    def perform_update(self, serializer):
        self._require_company()
        serializer.save()

    def perform_destroy(self, instance):
        self._require_company()
        instance.delete()


class SupplierDeclarationViewSet(TenantScopedViewSet):
    queryset = SupplierDeclaration.objects.all()
    serializer_class = s.SupplierDeclarationSerializer
    supplier_field = "supplier_id"

    def perform_create(self, serializer):
        """Un proveedor solo puede crear declaraciones a su propio nombre."""
        m = self.membership()
        if m and m.is_supplier:
            serializer.save(tenant=m.tenant, supplier=m.party)
        else:
            serializer.save()


class QualificationViewSet(TenantScopedViewSet):
    queryset = Qualification.objects.select_related("product", "treaty").all()
    serializer_class = s.QualificationSerializer
    # los proveedores no ven calificaciones (None)

    @action(detail=True, methods=["post"])
    def issue_certificate(self, request, pk=None):
        """Emite un certificado de origen para esta calificación."""
        qualification = self.get_object()
        d = request.data
        try:
            cert = issue_certificate(
                qualification,
                certifier_type=d.get("certifier_type", "exporter"),
                certifier_data=d.get("certifier_data"),
                exporter_data=d.get("exporter_data"),
                producer_data=d.get("producer_data"),
                importer_data=d.get("importer_data"),
                blanket_from=d.get("blanket_from"),
                blanket_to=d.get("blanket_to"),
                user=request.user,
            )
        except ValidationError as e:
            return Response({"error": e.messages[0]}, status=status.HTTP_400_BAD_REQUEST)
        return Response(s.CertificateSerializer(cert).data, status=status.HTTP_201_CREATED)


class OriginAnalysisViewSet(TenantScopedViewSet):
    """Histórico de análisis de origen (un snapshot por cada cálculo corrido).
    Solo la empresa: consultar (lista/detalle) y borrar. No se crea por API
    (se genera al correr el cálculo). Filtra por ?product= y ?treaty=."""
    queryset = OriginAnalysis.objects.select_related(
        "product", "treaty", "computed_by").all()
    serializer_class = s.OriginAnalysisSerializer
    # supplier_field = None (heredado): los proveedores no ven el histórico.
    http_method_names = ["get", "delete", "head", "options"]

    def get_serializer_class(self):
        return s.OriginAnalysisDetailSerializer if self.action == "retrieve" \
            else s.OriginAnalysisSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        pid = self.request.query_params.get("product")
        tid = self.request.query_params.get("treaty")
        if pid:
            qs = qs.filter(product_id=pid)
        if tid:
            qs = qs.filter(treaty_id=tid)
        return qs


class CertificateViewSet(TenantScopedViewSet):
    queryset = Certificate.objects.select_related(
        "qualification__product", "qualification__treaty").order_by("-issued_at")
    serializer_class = s.CertificateSerializer
    # los proveedores no ven certificados (None)

    @action(detail=True, methods=["get"])
    def elements(self, request, pk=None):
        """Devuelve los 9 elementos mínimos del T-MEC para impresión."""
        return Response(certificate_elements(self.get_object()))

    @action(detail=True, methods=["get"])
    def xlsx(self, request, pk=None):
        """Descarga el certificado de origen en formato oficial USMCA como .xlsx."""
        from django.http import HttpResponse
        from apps.origin.services import build_certificate_xlsx
        cert = self.get_object()
        content = build_certificate_xlsx(cert)
        resp = HttpResponse(content, content_type=(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
        resp["Content-Disposition"] = f'attachment; filename="certificado_{cert.folio}.xlsx"'
        return resp

    @action(detail=False, methods=["post"])
    def emit(self, request):
        """La EMPRESA emite y REGISTRA un certificado de origen (con folio) para
        UNO O VARIOS productos en un tratado, dirigido a un cliente. Todas las
        partes salen en el MISMO documento (multi-línea).
        Body: {products: [ids]} o {product: id} + {treaty, client, blanket_from?,
        blanket_to?, invoice_number?}. Los estados deben ser uniformes: todas
        CALIFICAN (certificado) o ninguna (affidavit VOM)."""
        from django.utils.dateparse import parse_date

        from apps.origin.services import _next_folio
        m = self.membership()
        if not m or m.is_supplier:
            raise PermissionDenied("Solo la empresa puede emitir certificados.")
        ids = request.data.get("products") or []
        if not ids and request.data.get("product"):
            ids = [request.data.get("product")]
        products = list(Product.objects.filter(tenant=m.tenant, pk__in=ids))
        product = products[0] if products else None
        treaty = Treaty.objects.filter(pk=request.data.get("treaty")).first()
        client = Party.objects.filter(tenant=m.tenant, kind=Party.Kind.CUSTOMER,
                                      pk=request.data.get("client")).first()
        if not (products and len(products) == len(set(ids)) and treaty and client):
            return Response({"error": "Selecciona producto(s), tratado y cliente válidos."},
                            status=status.HTTP_400_BAD_REQUEST)
        quals, sin_calculo = [], []
        for p in products:
            q = Qualification.objects.filter(tenant=m.tenant, product=p, treaty=treaty).first()
            if q:
                quals.append(q)
            else:
                sin_calculo.append(p.sku)
        if sin_calculo:
            return Response({"error": "Primero calcula el origen en “Cálculo de origen” "
                             f"para: {', '.join(sin_calculo)}."},
                            status=status.HTTP_400_BAD_REQUEST)
        # Un documento no puede mezclar bienes que califican con bienes que no:
        # el certificado declara que TODOS califican; el affidavit que NO.
        estados = {q.status == "QUALIFIES" for q in quals}
        if len(estados) > 1:
            si = [q.product.sku for q in quals if q.status == "QUALIFIES"]
            no = [q.product.sku for q in quals if q.status != "QUALIFIES"]
            return Response({"error": "No se pueden mezclar en un documento: "
                             f"CALIFICAN ({', '.join(si)}) y NO califican ({', '.join(no)}). "
                             "Emítelos por separado (certificado vs affidavit)."},
                            status=status.HTTP_400_BAD_REQUEST)
        qual = quals[0]
        # Si CALIFICAN → certificado de origen. Si NO califican → affidavit (VOM):
        # el documento se determina por el estado de la calificación al imprimir.
        prof = getattr(m.tenant, "profile", None)
        certifier = {
            "nombre": (prof.legal_name if prof and prof.legal_name else m.tenant.name),
            "rfc": prof.tax_id if prof else "",
            "direccion": ", ".join(p for p in [getattr(prof, "address", ""),
                         getattr(prof, "city", ""), getattr(prof, "state", "")] if p) if prof else "",
            "pais": prof.country if prof else "",
            "email": prof.contact_email if prof else "",
            "telefono": prof.contact_phone if prof else "",
            "firma_png": prof.signature_png if prof else "",
            "firmante": prof.signatory_name if prof else "",
            "cargo": prof.signatory_title if prof else "",
        }
        importer = {"nombre": client.name, "rfc": client.tax_id, "pais": client.country,
                    "direccion": client.address,
                    "email": client.email, "telefono": client.phone}
        cert = Certificate.objects.create(
            tenant=m.tenant, qualification=qual, folio=_next_folio(m.tenant),
            verify_token=secrets.token_urlsafe(16),
            certifier_type=Certificate.CertifierType.PRODUCER,
            certifier_data=certifier, exporter_data=certifier, producer_data=certifier,
            importer_data=importer,
            blanket_from=parse_date(request.data.get("blanket_from") or "") or None,
            blanket_to=parse_date(request.data.get("blanket_to") or "") or None,
            invoice_number=(request.data.get("invoice_number") or "").strip()[:60],
            issued_by=request.user)
        cert.qualifications.set(quals)  # todas las partes del documento (multi-línea)
        return Response(s.CertificateSerializer(cert, context={"request": request}).data,
                        status=status.HTTP_201_CREATED)


class SolicitationCertificateViewSet(TenantScopedViewSet):
    """Certificado de origen del PROVEEDOR por solicitud. La empresa lo ve (por
    tenant); el proveedor ve los suyos y es quien FIRMA, cumpliendo el método que
    la empresa exigió al aceptar. La empresa NO puede firmar (solo lectura)."""
    queryset = SolicitationCertificate.objects.select_related("solicitation").all()
    serializer_class = s.SolicitationCertificateSerializer
    supplier_field = "solicitation__supplier_id"
    http_method_names = ["get", "post", "head", "options"]

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["request"] = self.request
        return ctx

    @action(detail=True, methods=["post"], url_path="sign")
    def sign(self, request, pk=None):
        """El proveedor firma cumpliendo el método EXIGIDO por la empresa.
        Body: {scanned_file?} (data URI, solo para métodos manuales)."""
        m = self.membership()
        if not m or not m.is_supplier:
            raise PermissionDenied("Solo el proveedor puede firmar el certificado.")
        cert = self.get_object()  # ya acotado a su Party
        if cert.needs_png:
            prof = getattr(cert.solicitation.supplier, "profile", None)
            firma = prof.signature_png if prof else ""
            if not firma:
                return Response({"error": "No tienes una firma digital cargada. Súbela en "
                                 "“Datos del proveedor” antes de firmar."},
                                status=status.HTTP_400_BAD_REQUEST)
            cert.signature_png = firma
        if cert.needs_scan:
            scanned = (request.data.get("scanned_file") or "").strip()
            if not scanned.startswith("data:"):
                return Response({"error": "Sube el certificado firmado (imagen o PDF)."},
                                status=status.HTTP_400_BAD_REQUEST)
            if len(scanned) > 6_000_000:
                return Response({"error": "El archivo es muy grande (máx ~4 MB)."},
                                status=status.HTTP_400_BAD_REQUEST)
            cert.scanned_file = scanned
        if cert.needs_qr and not cert.verify_token:
            import secrets
            cert.verify_token = secrets.token_urlsafe(16)[:32]
        cert.signed = True
        cert.signed_at = timezone.now()
        cert.signed_by = request.user
        cert.save()
        _log_sol(cert.solicitation, "cert_signed", cert.get_sign_method_display(), request.user)
        return Response(s.SolicitationCertificateSerializer(
            cert, context=self.get_serializer_context()).data)


class ClientLayoutViewSet(TenantScopedViewSet):
    """Plantillas del portal de origen de cada CLIENTE (una por tratado).
    Solo la empresa las gestiona; los proveedores no las ven."""
    queryset = ClientOriginLayout.objects.select_related("client", "treaty").all()
    serializer_class = s.ClientOriginLayoutSerializer
    supplier_field = None

    def get_queryset(self):
        qs = super().get_queryset()
        client = self.request.query_params.get("client")
        if client:
            qs = qs.filter(client_id=client)
        return qs

    def _require_company(self):
        m = self.membership()
        if not m or m.is_supplier:
            raise PermissionDenied("Solo la empresa gestiona los layouts de cliente.")
        return m

    def create(self, request, *args, **kwargs):
        """Sube (o reemplaza) la plantilla del cliente para un tratado.
        Multipart: {file, client, treaty, name?}. Detecta hoja y encabezados;
        conserva el mapeo previo de las columnas que sigan existiendo."""
        import base64
        m = self._require_company()
        client = Party.objects.filter(tenant=m.tenant, kind=Party.Kind.CUSTOMER,
                                      pk=request.data.get("client")).first()
        treaty = Treaty.objects.filter(pk=request.data.get("treaty")).first()
        f = request.FILES.get("file")
        if not (client and treaty and f):
            return Response({"error": "Faltan cliente, tratado o el archivo .xlsx."},
                            status=status.HTTP_400_BAD_REQUEST)
        content = f.read()
        if len(content) > 2_000_000:
            return Response({"error": "La plantilla es muy grande (máx 2 MB)."},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            sheet, header_row, headers = client_layouts.read_template(content)
        except Exception:
            return Response({"error": "No se pudo leer el archivo. ¿Es un .xlsx válido?"},
                            status=status.HTTP_400_BAD_REQUEST)
        if not headers:
            return Response({"error": "No se encontraron encabezados en la plantilla."},
                            status=status.HTTP_400_BAD_REQUEST)
        layout, created = ClientOriginLayout.objects.get_or_create(
            tenant=m.tenant, client=client, treaty=treaty)
        # Conserva el mapeo de columnas que siguen existiendo en la nueva plantilla.
        old_mapping = layout.mapping or {}
        layout.mapping = {col: k for col, k in old_mapping.items() if col in headers}
        layout.name = (request.data.get("name") or layout.name or "").strip()[:120]
        layout.filename = f.name[:200]
        layout.file_b64 = base64.b64encode(content).decode()
        layout.sheet_name = sheet
        layout.header_row = header_row
        layout.headers = headers
        layout.save()
        return Response(s.ClientOriginLayoutSerializer(layout).data,
                        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    def perform_update(self, serializer):
        self._require_company()
        # Solo el mapeo y el nombre son editables; valida los campos del mapeo.
        mapping = serializer.validated_data.get("mapping")
        if mapping is not None:
            bad = [k for k in mapping.values() if k and k not in client_layouts.LAYOUT_FIELD_KEYS]
            if bad:
                from rest_framework.exceptions import ValidationError as DRFValidationError
                raise DRFValidationError({"mapping": f"Campos inválidos: {', '.join(bad)}"})
            serializer.validated_data["mapping"] = {
                col: k for col, k in mapping.items() if k}
        serializer.save()

    def perform_destroy(self, instance):
        self._require_company()
        instance.delete()

    @action(detail=True, methods=["post"])
    def generate(self, request, pk=None):
        """Genera el archivo del portal del cliente con los cálculos de origen.
        Body: {products: [ids], period_from?, period_to?}. Descarga el .xlsx."""
        from django.http import HttpResponse
        m = self._require_company()
        layout = self.get_object()
        if not layout.mapping:
            return Response({"error": "Primero mapea las columnas de la plantilla."},
                            status=status.HTTP_400_BAD_REQUEST)
        ids = request.data.get("products") or []
        products = list(Product.objects.filter(tenant=m.tenant, id__in=ids)
                        .select_related("supplier").order_by("sku"))
        if not products:
            return Response({"error": "Selecciona al menos un producto."},
                            status=status.HTTP_400_BAD_REQUEST)
        quals = {q.product_id: q for q in Qualification.objects.filter(
            tenant=m.tenant, treaty=layout.treaty, product_id__in=ids)}
        prof = getattr(m.tenant, "profile", None)
        ctx = {
            "treaty_label": client_layouts._TREATY_LABELS.get(layout.treaty.code, layout.treaty.code),
            "period_from": (request.data.get("period_from") or ""),
            "period_to": (request.data.get("period_to") or ""),
            "date": timezone.localdate().isoformat(),
            "company_name": (prof.legal_name if prof and prof.legal_name else m.tenant.name),
            "company_tax_id": (prof.tax_id if prof else ""),
            "company_country": (prof.country if prof else ""),
            "client_name": layout.client.name,
        }
        try:
            content = client_layouts.generate_layout(
                layout, [(p, quals.get(p.id)) for p in products], ctx)
        except Exception:
            return Response({"error": "No se pudo generar el archivo. Vuelve a subir la "
                             "plantilla e intenta de nuevo."},
                            status=status.HTTP_400_BAD_REQUEST)
        fname = f"layout_{layout.client.name}_{layout.treaty.code}.xlsx".replace(" ", "_")
        resp = HttpResponse(content, content_type=(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
        resp["Content-Disposition"] = f'attachment; filename="{fname}"'
        return resp


class SolicitationRequestViewSet(TenantScopedViewSet):
    queryset = SolicitationRequest.objects.select_related(
        "product", "supplier", "treaty").all()
    serializer_class = s.SolicitationRequestSerializer
    supplier_field = "supplier_id"  # el proveedor solo ve sus solicitudes

    @action(detail=False, methods=["post"], url_path="batch")
    def create_batch(self, request):
        """La empresa crea solicitudes de origen para varios productos a la vez.
        Body: {treaty, period_type, period_from, period_to, products: [ids]}.
        El proveedor de cada solicitud sale del proveedor del producto."""
        m = self.membership()
        if not m or m.is_supplier:
            raise PermissionDenied("Solo la empresa puede crear solicitudes.")
        treaty = Treaty.objects.filter(pk=request.data.get("treaty")).first()
        if not treaty:
            return Response({"error": "Falta el tratado o no existe."},
                            status=status.HTTP_400_BAD_REQUEST)
        ids = request.data.get("products") or []
        if not ids:
            return Response({"error": "Selecciona al menos un producto."},
                            status=status.HTTP_400_BAD_REQUEST)
        products = Product.objects.filter(tenant_id=m.tenant_id, id__in=ids)
        period_type = request.data.get("period_type", "")
        period_from = request.data.get("period_from") or None
        period_to = request.data.get("period_to") or None
        due_date = request.data.get("due_date") or None
        bom_analysis = bool(request.data.get("bom_analysis"))
        created, sin_proveedor = [], []
        for p in products:
            if not p.supplier_id:
                sin_proveedor.append(p.sku)
                continue
            created.append(SolicitationRequest.objects.create(
                tenant=m.tenant, supplier_id=p.supplier_id, product=p, treaty=treaty,
                status=SolicitationRequest.Status.SENT, sent_at=timezone.now(),
                period_type=period_type, period_from=period_from, period_to=period_to,
                due_date=due_date, bom_analysis=bom_analysis))
        return Response({"creadas": len(created), "sin_proveedor": sin_proveedor},
                        status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="submit-bom")
    def submit_bom(self, request, pk=None):
        """El proveedor sube el BOM (lista de materiales) de una solicitud con
        análisis por BOM. Body: {rule, notes, lines:[{part_number, description,
        unit_price, quantity, country}]}. Guarda el BOM y marca respondida.
        El cálculo de origen se hace en otro módulo."""
        sr = self.get_object()  # ya acotada al proveedor logueado
        if not sr.bom_analysis:
            return Response({"error": "Esta solicitud no pide análisis por BOM."},
                            status=status.HTTP_400_BAD_REQUEST)
        lines = request.data.get("lines") or []
        if not lines:
            return Response({"error": "Agrega al menos un componente al BOM."},
                            status=status.HTTP_400_BAD_REQUEST)
        rule_id = request.data.get("rule") or None
        with transaction.atomic():
            bom, _ = SolicitationBOM.objects.get_or_create(
                solicitation=sr, defaults={"tenant": sr.tenant})
            bom.rule_id = rule_id
            bom.notes = request.data.get("notes", "")
            bom.rvc_method = request.data.get("rvc_method") or "transaction"
            bom.net_cost = request.data.get("net_cost") or 0
            # Guardar invalida el cálculo previo: hay que recalcular antes de enviar.
            bom.origin_status = ""
            bom.criterion = ""
            bom.rvc_value = None
            bom.detail = {}
            bom.computed_at = None
            bom.save()
            bom.lines.all().delete()
            for ln in lines:
                SolicitationBOMLine.objects.create(
                    tenant=sr.tenant, bom=bom,
                    part_number=(ln.get("part_number") or "").strip(),
                    description=(ln.get("description") or "").strip(),
                    hs_code=(ln.get("hs_code") or "").strip(),
                    unit_price=ln.get("unit_price") or 0,
                    quantity=ln.get("quantity") or 0,
                    uom=clean_uom(ln.get("uom")),
                    country=(ln.get("country") or "").strip().upper()[:2],
                    has_origin_evidence=bool(ln.get("has_origin_evidence")))
        # Guardar el BOM NO responde la solicitud; eso lo hace "enviar".
        _log_sol(sr, "bom_saved", f"{len(lines)} componente(s)", request.user)
        return Response(s.SolicitationRequestSerializer(sr).data)

    @action(detail=True, methods=["post"], url_path="import-bom")
    def import_bom(self, request, pk=None):
        """El proveedor responde una solicitud por BOM subiendo un layout .xlsx
        (para solicitudes grandes). Reemplaza las líneas del BOM. No envía: el
        proveedor revisa, calcula y envía como en el flujo manual."""
        from apps.origin import bulk
        sr = self.get_object()  # acotada al proveedor logueado
        if not sr.bom_analysis:
            return Response({"error": "Esta solicitud no pide análisis por BOM."},
                            status=status.HTTP_400_BAD_REQUEST)
        if sr.status == SolicitationRequest.Status.ACCEPTED:
            return Response({"error": "Esta solicitud ya fue aceptada por el cliente."},
                            status=status.HTTP_400_BAD_REQUEST)
        f = request.FILES.get("file")
        if not f:
            return Response({"error": "Adjunta el archivo .xlsx."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            rows = bulk.read_rows(f, bulk.BOM_RESPONSE_COLUMNS)
        except Exception:
            return Response({"error": "No se pudo leer el archivo. Usa la plantilla."},
                            status=status.HTTP_400_BAD_REQUEST)
        if not rows:
            return Response({"error": "El archivo no tiene componentes."},
                            status=status.HTTP_400_BAD_REQUEST)

        def _truthy(v):
            return str(v or "").strip().lower() in ("si", "sí", "yes", "y", "1", "true", "x")

        with transaction.atomic():
            bom, _ = SolicitationBOM.objects.get_or_create(
                solicitation=sr, defaults={"tenant": sr.tenant})
            # Subir el BOM invalida el cálculo previo (hay que recalcular).
            bom.origin_status = ""; bom.criterion = ""; bom.rvc_value = None
            bom.detail = {}; bom.computed_at = None
            bom.save()
            bom.lines.all().delete()
            n = 0
            for r in rows:
                part = str(r.get("num_parte") or "").strip()
                if not part:
                    continue
                SolicitationBOMLine.objects.create(
                    tenant=sr.tenant, bom=bom, part_number=part,
                    description=str(r.get("descripcion") or "").strip(),
                    hs_code="".join(c for c in str(r.get("hs_code") or "") if c.isdigit())[:10],
                    unit_price=r.get("precio_unitario") or 0,
                    quantity=r.get("cantidad") or 0,
                    uom=clean_uom(r.get("uom")),
                    country="".join(c for c in str(r.get("pais") or "") if c.isalpha()).upper()[:2],
                    has_origin_evidence=_truthy(r.get("evidencia")))
                n += 1
        _log_sol(sr, "bom_saved", f"{n} componente(s) por layout", request.user)
        return Response(s.SolicitationRequestSerializer(sr).data)

    @action(detail=True, methods=["post"], url_path="copy-previous")
    def copy_previous(self, request, pk=None):
        """Trae la información del periodo ANTERIOR del mismo producto+proveedor.
        Por BOM: regla + líneas. Por declaración manual: los valores declarados."""
        sr = self.get_object()
        if sr.bom_analysis:
            prev = (SolicitationBOM.objects
                    .filter(solicitation__product_id=sr.product_id,
                            solicitation__supplier_id=sr.supplier_id)
                    .exclude(solicitation_id=sr.id)
                    .order_by("-created_at").first())
            if not prev or not prev.lines.exists():
                return Response({"found": False})
            lines = [{
                "part_number": l.part_number, "description": l.description,
                "hs_code": l.hs_code, "unit_price": str(l.unit_price),
                "quantity": str(l.quantity), "uom": l.uom, "country": l.country,
                "has_origin_evidence": l.has_origin_evidence,
            } for l in prev.lines.all()]
            src = prev.solicitation
            src_period = f"{src.get_period_type_display()} {src.period_from} → {src.period_to}".strip()
            _log_sol(sr, "copied_previous", f"BOM de solicitud #{src.id} ({src_period})", request.user)
            return Response({"found": True, "type": "bom", "rule": prev.rule_id,
                             "lines": lines, "source_period": src_period})
        # Declaración manual: última declaración entregada de ese producto/proveedor.
        decl = (SupplierDeclaration.objects
                .filter(tenant=sr.tenant, product_id=sr.product_id, supplier_id=sr.supplier_id)
                .order_by("-created_at").first())
        if not decl:
            return Response({"found": False})
        _log_sol(sr, "copied_previous", "declaración anterior", request.user)
        return Response({"found": True, "type": "manual",
                         "is_originating": decl.is_originating,
                         "country_of_origin": decl.country_of_origin,
                         "rule": decl.rule_id,
                         "value_originating": str(decl.value_originating),
                         "value_non_originating": str(decl.value_non_originating),
                         "source_period": f"{decl.valid_from} → {decl.valid_to}"})

    @action(detail=True, methods=["post"], url_path="send-bom")
    def send_bom(self, request, pk=None):
        """El proveedor ENVÍA al cliente: marca la solicitud como respondida.
        Requiere BOM guardado y origen ya calculado."""
        sr = self.get_object()
        if not sr.bom_analysis:
            return Response({"error": "Esta solicitud no es por BOM."},
                            status=status.HTTP_400_BAD_REQUEST)
        bom = SolicitationBOM.objects.filter(solicitation=sr).first()
        if not bom or not bom.lines.exists():
            return Response({"error": "Primero guarda el BOM."},
                            status=status.HTTP_400_BAD_REQUEST)
        if not bom.origin_status:
            return Response({"error": "Primero calcula el origen antes de enviar."},
                            status=status.HTTP_400_BAD_REQUEST)
        if sr.status == SolicitationRequest.Status.ACCEPTED:
            return Response({"error": "Esta solicitud ya fue aceptada por el cliente."},
                            status=status.HTTP_400_BAD_REQUEST)
        sr.status = SolicitationRequest.Status.RESPONDED
        sr.responded_at = timezone.now()
        sr.rejection_reason = ""  # al reenviar se limpia el rechazo previo
        sr.save(update_fields=["status", "responded_at", "rejection_reason", "updated_at"])
        unchanged = bool(request.data.get("unchanged"))
        _log_sol(sr, "sent_unchanged" if unchanged else "sent",
                 "SIN cambios respecto al periodo anterior" if unchanged else "",
                 request.user)
        return Response(s.SolicitationRequestSerializer(sr).data)

    @action(detail=True, methods=["post"])
    def accept(self, request, pk=None):
        """La EMPRESA acepta la declaración respondida por el proveedor."""
        m = self.membership()
        if not m or m.is_supplier:
            raise PermissionDenied("Solo la empresa puede aceptar o rechazar.")
        sr = self.get_object()
        if sr.status != SolicitationRequest.Status.RESPONDED:
            return Response({"error": "Solo puedes aceptar solicitudes respondidas."},
                            status=status.HTTP_400_BAD_REQUEST)
        # La empresa elige CÓMO debe firmar el proveedor el certificado.
        sign_method = (request.data.get("sign_method") or "png").strip()
        if sign_method not in SolicitationCertificate.Method.values:
            return Response({"error": "Método de firma inválido."},
                            status=status.HTTP_400_BAD_REQUEST)
        sr.status = SolicitationRequest.Status.ACCEPTED
        sr.rejection_reason = ""
        sr.save(update_fields=["status", "rejection_reason", "updated_at"])
        cert = ensure_solicitation_certificate(sr, request.user, sign_method)
        _log_sol(sr, "accepted", f"firma exigida: {cert.get_sign_method_display()}", request.user)
        return Response(s.SolicitationRequestSerializer(sr).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        """La EMPRESA rechaza la declaración indicando el motivo (texto libre)."""
        m = self.membership()
        if not m or m.is_supplier:
            raise PermissionDenied("Solo la empresa puede aceptar o rechazar.")
        sr = self.get_object()
        if sr.status != SolicitationRequest.Status.RESPONDED:
            return Response({"error": "Solo puedes rechazar solicitudes respondidas."},
                            status=status.HTTP_400_BAD_REQUEST)
        reason = (request.data.get("reason") or "").strip()
        if not reason:
            return Response({"error": "Indica el motivo del rechazo."},
                            status=status.HTTP_400_BAD_REQUEST)
        sr.status = SolicitationRequest.Status.REJECTED
        sr.rejection_reason = reason
        sr.save(update_fields=["status", "rejection_reason", "updated_at"])
        _log_sol(sr, "rejected", reason[:200], request.user)
        return Response(s.SolicitationRequestSerializer(sr).data)

    @action(detail=True, methods=["post"], url_path="calculate-origin")
    def calculate_origin(self, request, pk=None):
        """Calcula el origen del producto a partir del BOM ya capturado.
        Devuelve el resultado y la traza del análisis (CTC / VCR)."""
        sr = self.get_object()
        bom = SolicitationBOM.objects.filter(solicitation=sr).first()
        if not bom or not bom.lines.exists():
            return Response({"error": "Primero guarda el BOM con sus componentes."},
                            status=status.HTTP_400_BAD_REQUEST)
        result = calculate_bom_origin(bom)
        _log_sol(sr, "origin_calculated",
                 f"{result.get('status')} ({result.get('criterion') or '—'})", request.user)
        return Response(result)

    @action(detail=True, methods=["post"])
    def respond(self, request, pk=None):
        """El proveedor logueado responde su solicitud con su declaración de origen.
        Body: {is_originating, country_of_origin, valid_from, valid_to}."""
        sr = self.get_object()  # ya viene acotada a SUS solicitudes
        if sr.bom_analysis:
            return Response({"error": "Esta solicitud requiere análisis por BOM. "
                             "Sube el BOM en vez de declarar manualmente."},
                            status=status.HTTP_400_BAD_REQUEST)
        if sr.status in (SolicitationRequest.Status.RESPONDED, SolicitationRequest.Status.ACCEPTED):
            return Response({"error": "Esta solicitud ya fue respondida."},
                            status=status.HTTP_400_BAD_REQUEST)
        d = request.data
        # Si el proveedor no indica vigencia, se usa el periodo que pidió la empresa.
        valid_from = d.get("valid_from") or sr.period_from
        valid_to = d.get("valid_to") or sr.period_to
        if not valid_from or not valid_to:
            return Response({"error": "Faltan las fechas de vigencia."},
                            status=status.HTTP_400_BAD_REQUEST)
        from decimal import Decimal
        def _dec(x):
            try:
                return Decimal(str(x or 0))
            except Exception:
                return Decimal("0")
        v_orig = _dec(d.get("value_originating"))
        v_non = _dec(d.get("value_non_originating"))
        price = sr.product.unit_cost or Decimal("0")
        if price and (v_orig + v_non) > price:
            return Response({"error": "La suma de materiales (originarios + no originarios) "
                             f"no puede superar el precio de venta del producto ({price})."},
                            status=status.HTTP_400_BAD_REQUEST)
        decl = SupplierDeclaration.objects.create(
            tenant=sr.tenant, supplier=sr.supplier, product=sr.product, treaty=sr.treaty,
            is_originating=bool(d.get("is_originating")),
            country_of_origin=d.get("country_of_origin", ""),
            rule_id=d.get("rule") or None,
            value_originating=v_orig, value_non_originating=v_non,
            valid_from=valid_from, valid_to=valid_to,
        )
        _log_sol(sr, "sent", "declaración manual", request.user)
        sr.declaration = decl
        sr.status = SolicitationRequest.Status.RESPONDED
        sr.responded_at = timezone.now()
        sr.rejection_reason = ""
        sr.save(update_fields=["declaration", "status", "responded_at", "rejection_reason", "updated_at"])
        return Response(s.SolicitationRequestSerializer(sr).data)

    @action(detail=False, methods=["post"], url_path="declaration-template")
    def declaration_template(self, request):
        """Plantilla .xlsx PRE-CARGADA para responder EN LOTE solicitudes de
        DECLARACIÓN (no BOM). Body: {ids:[...]}. Solo el proveedor."""
        from django.http import HttpResponse
        from apps.origin import bulk
        m = self.membership()
        if not m or not m.is_supplier:
            raise PermissionDenied("Solo el proveedor responde solicitudes.")
        ids = request.data.get("ids") or []
        qs = self.get_queryset().filter(id__in=ids, bom_analysis=False).exclude(
            status__in=[SolicitationRequest.Status.RESPONDED,
                        SolicitationRequest.Status.ACCEPTED]).select_related("product")
        rows = [{"num_parte": sr.product.sku, "descripcion": sr.product.description,
                 "hs_code": sr.product.hs_code or ""} for sr in qs]
        content = bulk.make_template(
            bulk.DECLARATION_RESPONSE_COLUMNS, "Declaración de origen",
            instructions=bulk.DECLARATION_RESPONSE_INSTRUCTIONS,
            col_help=bulk.DECLARATION_RESPONSE_HELP, data_rows=rows or None)
        resp = HttpResponse(content, content_type=(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
        resp["Content-Disposition"] = 'attachment; filename="plantilla_declaracion_origen.xlsx"'
        return resp

    @action(detail=False, methods=["post"], url_path="import-declarations")
    def import_declarations(self, request):
        """El proveedor responde EN LOTE solicitudes de declaración subiendo el
        layout. Multipart: file + ids (lista separada por comas). Crea la
        declaración y marca RESPONDIDA cada parte cuyo SKU aparezca en el archivo."""
        from decimal import Decimal
        from apps.origin import bulk
        m = self.membership()
        if not m or not m.is_supplier:
            raise PermissionDenied("Solo el proveedor responde solicitudes.")
        f = request.FILES.get("file")
        if not f:
            return Response({"error": "Adjunta el archivo .xlsx."}, status=status.HTTP_400_BAD_REQUEST)
        ids = [int(x) for x in str(request.data.get("ids") or "").split(",") if x.strip().isdigit()]
        try:
            rows = bulk.read_rows(f, bulk.DECLARATION_RESPONSE_COLUMNS)
        except Exception:
            return Response({"error": "No se pudo leer el archivo. Usa la plantilla."},
                            status=status.HTTP_400_BAD_REQUEST)
        base = self.get_queryset().filter(bom_analysis=False).exclude(
            status__in=[SolicitationRequest.Status.RESPONDED, SolicitationRequest.Status.ACCEPTED])
        if ids:
            base = base.filter(id__in=ids)
        by_sku = {}
        for sr in base.select_related("product"):
            by_sku.setdefault((sr.product.sku or "").strip().upper(), sr)

        def _dec(x):
            try:
                return Decimal(str(x or 0))
            except Exception:
                return Decimal("0")

        def _truthy(v):
            return str(v or "").strip().lower() in ("si", "sí", "yes", "y", "1", "true", "x")

        respondidas = 0
        errores = []
        with transaction.atomic():
            for r in rows:
                sku = str(r.get("num_parte") or "").strip().upper()
                if not sku:
                    continue
                sr = by_sku.get(sku)
                if not sr:
                    errores.append(f"{sku}: no es una solicitud pendiente tuya (omitido).")
                    continue
                if not sr.period_from or not sr.period_to:
                    errores.append(f"{sku}: la solicitud no tiene periodo de vigencia (omitido).")
                    continue
                v_orig = _dec(r.get("valor_originario"))
                v_non = _dec(r.get("valor_no_originario"))
                price = sr.product.unit_cost or Decimal("0")
                if price and (v_orig + v_non) > price:
                    errores.append(f"{sku}: materiales ({v_orig + v_non}) > precio ({price}); omitido.")
                    continue
                decl = SupplierDeclaration.objects.create(
                    tenant=sr.tenant, supplier=sr.supplier, product=sr.product, treaty=sr.treaty,
                    is_originating=_truthy(r.get("originario")),
                    country_of_origin="".join(c for c in str(r.get("pais") or "") if c.isalpha()).upper()[:2],
                    value_originating=v_orig, value_non_originating=v_non,
                    valid_from=sr.period_from, valid_to=sr.period_to)
                sr.declaration = decl
                sr.status = SolicitationRequest.Status.RESPONDED
                sr.responded_at = timezone.now()
                sr.rejection_reason = ""
                sr.save(update_fields=["declaration", "status", "responded_at",
                                       "rejection_reason", "updated_at"])
                _log_sol(sr, "sent", "declaración por layout", request.user)
                respondidas += 1
        return Response({"respondidas": respondidas, "errores": errores})


@api_view(["POST"])
@permission_classes([AllowAny])
def login_view(request):
    """Login con token. Bloquea a usuarios cuya empresa no tenga licencia válida.

    - Empresa/admin: {username, password}.
    - Proveedor: {tenant_slug, supplier_slug, username, password} — el usuario es
      único DENTRO de su proveedor, no global (dos empresas pueden tener el mismo
      proveedor con el mismo nombre de usuario sin chocar)."""
    username = (request.data.get("username") or "").strip()
    password = request.data.get("password") or ""
    tenant_slug = (request.data.get("tenant_slug") or "").strip().lower()
    supplier_slug = (request.data.get("supplier_slug") or "").strip().lower()

    # 1) Resolver el usuario objetivo (sin validar contraseña aún) para poder
    #    contar intentos fallidos y aplicar el bloqueo.
    if supplier_slug:
        tenant = Tenant.objects.filter(slug=tenant_slug).first()
        party = (Party.objects.filter(tenant=tenant, slug=supplier_slug,
                                      kind=Party.Kind.SUPPLIER).first()
                 if tenant else None)
        mem = None
        if party:
            mem = (Membership.objects.filter(party=party, role=Membership.Role.SUPPLIER)
                   .filter(Q(login_name__iexact=username) | Q(user__username=username))
                   .select_related("user").first())
        if not mem:
            return Response({"error": "Empresa, proveedor o usuario incorrectos."},
                            status=status.HTTP_400_BAD_REQUEST)
        target = mem.user
    else:
        target = User.objects.filter(username=username).first()

    # 2) Si ya está bloqueado, no dejar entrar (ni con contraseña correcta).
    sec = None
    if target:
        sec, _ = UserSecurity.objects.get_or_create(user=target)
        if sec.is_locked:
            return Response({"error": _locked_message(target)},
                            status=status.HTTP_403_FORBIDDEN)

    # 3) Validar contraseña.
    user = authenticate(username=target.username, password=password) if target else None

    if not user:
        # Contar el intento fallido y avisar/ bloquear.
        if sec:
            sec.failed_attempts += 1
            if sec.failed_attempts >= MAX_LOGIN_ATTEMPTS:
                sec.is_locked = True
                sec.save(update_fields=["failed_attempts", "is_locked", "updated_at"])
                return Response({"error": _locked_message(target)},
                                status=status.HTTP_403_FORBIDDEN)
            sec.save(update_fields=["failed_attempts", "updated_at"])
            restantes = MAX_LOGIN_ATTEMPTS - sec.failed_attempts
            msg = "Usuario o contraseña incorrectos."
            if restantes <= 3:
                s = "s" if restantes != 1 else ""
                msg += (f" Te queda{'n' if restantes != 1 else ''} {restantes} "
                        f"intento{s} antes de bloquear la cuenta.")
            return Response({"error": msg}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"error": "Usuario o contraseña incorrectos."},
                        status=status.HTTP_400_BAD_REQUEST)

    # 4) Éxito: reiniciar el contador de intentos.
    if sec and sec.failed_attempts:
        sec.failed_attempts = 0
        sec.save(update_fields=["failed_attempts", "updated_at"])
    if not user.is_superuser:
        m = user.memberships.select_related("tenant").first()
        lic = getattr(m.tenant, "license", None) if m else None
        if lic and not lic.is_valid:
            monto = ""
            if lic.renewal_amount and lic.renewal_amount > 0:
                monto = (f" Monto de renovación: {lic.renewal_amount} "
                         f"{lic.renewal_currency}.")
            return Response(
                {"error": "Sistema SUSPENDIDO por vencimiento de licencia. "
                          "Contacta a tu proveedor LogiQ Aduanas para renovar." + monto},
                status=status.HTTP_403_FORBIDDEN)
    token, _ = Token.objects.get_or_create(user=user)
    return Response({"token": token.key})


@api_view(["GET"])
@permission_classes([AllowAny])
def verify_certificate(request, token):
    """Página pública de verificación de un certificado (la apunta el QR).
    No requiere autenticación; muestra solo datos no sensibles."""
    from django.http import HttpResponse
    from django.utils.html import escape
    cert = (Certificate.objects.select_related(
        "qualification__product", "qualification__treaty", "tenant")
        .filter(verify_token=token).first() if token else None)
    navy = "#043a70"
    if not cert:
        body = ('<div class="card"><h1 class="bad">Certificado no encontrado · '
                'Certificate not found</h1>'
                '<p>El código no corresponde a ningún certificado emitido en esta plataforma.<br>'
                '<span class="en">The code does not match any certificate issued on this platform.</span></p></div>')
    else:
        q = cert.qualification
        quals = (list(cert.qualifications.select_related("product").all()) or [q])
        ce = cert.certifier_data or {}
        im = cert.importer_data or {}
        treaty = s.TREATY_LABELS.get(q.treaty.code, q.treaty.code)
        is_aff = q.status != "QUALIFIES"
        doc_es, doc_en = (("Affidavit de origen (VOM)", "Affidavit of Origin (VOM)")
                          if is_aff else ("Certificado de origen", "Certificate of Origin"))
        # Etiquetas BILINGÜES: quien escanea suele ser la autoridad/importador en EE.UU.
        rows = "".join(
            f'<tr><td class="k">{k_es}<br><span class="en">{k_en}</span></td>'
            f'<td>{escape(str(v))}</td></tr>' for k_es, k_en, v in [
                ("Folio", "Document No.", cert.folio),
                ("Documento", "Document type", f"{doc_es} / {doc_en}"),
                ("Producto(s)", "Product(s)",
                 "; ".join(f"{x.product.sku} — {x.product.description}" for x in quals)),
                ("Fracción (HS)", "HS classification",
                 ", ".join(sorted({x.product.hs_code or "—" for x in quals}))),
                ("Tratado", "Trade agreement", treaty),
                ("Exportador / Productor", "Exporter / Producer",
                 ce.get("nombre", cert.tenant.name)),
                ("Importador", "Importer", im.get("nombre", "—")),
                ("Emitido el", "Issued on", cert.issued_at.strftime("%Y-%m-%d")),
            ])
        body = (f'<div class="card">'
                f'<h1 class="ok">✓ Documento auténtico · Authentic document</h1>'
                f'<p class="sub">Este {doc_es.lower()} <strong>es real</strong>: fue emitido en esta '
                f'plataforma y su contenido coincide con el registro.<br>'
                f'<span class="en">This {doc_en.lower()} <strong>is genuine</strong>: it was issued on this '
                f'platform and its contents match the official record.</span></p>'
                f'<table>{rows}</table>'
                f'<p class="note">Verificación pública de autenticidad · Public authenticity '
                f'verification. LogiQ Aduanas | FTA.</p></div>')
    html = (f'<!doctype html><html lang="es"><head><meta charset="utf-8">'
            f'<meta name="viewport" content="width=device-width, initial-scale=1">'
            f'<title>Verificación de certificado · Certificate verification</title><style>'
            f'body{{font-family:Arial,Helvetica,sans-serif;background:#f3f4f6;margin:0;padding:24px;color:#1f2937}}'
            f'.card{{max-width:560px;margin:24px auto;background:#fff;border-radius:14px;padding:24px;'
            f'box-shadow:0 1px 3px rgba(0,0,0,.1)}} h1{{font-size:20px;margin:0 0 10px}}'
            f'.ok{{color:#15803d}} .bad{{color:#b91c1c}} .sub{{font-size:14px;margin:0 0 16px}}'
            f'.en{{color:#6b7280;font-style:italic}} table{{width:100%;border-collapse:collapse}}'
            f'td{{border-bottom:1px solid #eee;padding:8px 6px;font-size:14px;vertical-align:top}}'
            f'td.k{{color:#374151;width:42%;font-size:13px}} td.k .en{{font-size:11px}}'
            f'.note{{margin-top:16px;font-size:12px;color:#9ca3af}}'
            f'.brand{{color:{navy};font-weight:bold;font-size:18px;text-align:center}}</style></head>'
            f'<body><div class="brand">LogiQ Aduanas | FTA</div>{body}</body></html>')
    return HttpResponse(html)


def _verify_page(body):
    from django.http import HttpResponse
    navy = "#043a70"
    return HttpResponse(
        f'<!doctype html><html lang="es"><head><meta charset="utf-8">'
        f'<meta name="viewport" content="width=device-width, initial-scale=1">'
        f'<title>Verificar certificado — LogiQ Aduanas</title><style>'
        f'body{{font-family:Arial,Helvetica,sans-serif;background:#f3f4f6;margin:0;padding:24px;color:#1f2937}}'
        f'.card{{max-width:560px;margin:24px auto;background:#fff;border-radius:14px;padding:24px;'
        f'box-shadow:0 1px 3px rgba(0,0,0,.1)}} h1{{font-size:20px;margin:0 0 16px}}'
        f'.ok{{color:#15803d}} .bad{{color:#b91c1c}} table{{width:100%;border-collapse:collapse}}'
        f'td{{border-bottom:1px solid #eee;padding:8px 6px;font-size:14px;vertical-align:top}}'
        f'td.k{{color:#6b7280;width:42%}} .note{{margin-top:16px;font-size:12px;color:#9ca3af}}'
        f'.brand{{color:{navy};font-weight:bold;font-size:18px;text-align:center}}</style></head>'
        f'<body><div class="brand">LogiQ Aduanas | FTA</div>{body}</body></html>')


@api_view(["GET"])
@permission_classes([AllowAny])
def verify_solicitation_certificate(request, token):
    """Página pública (QR) de verificación de un certificado de origen del proveedor."""
    from django.utils.html import escape
    cert = (SolicitationCertificate.objects.filter(verify_token=token).first()
            if token else None)
    if not cert or not cert.signed or not cert.needs_qr:
        return _verify_page(
            '<div class="card"><h1 class="bad">Certificado no encontrado</h1>'
            '<p>El código no corresponde a ningún certificado de origen firmado.</p></div>')
    d = cert.data or {}
    prod = d.get("product") or {}
    origin = d.get("origin") or {}
    producer = d.get("producer") or {}
    treaty = (d.get("treaty") or {}).get("label", "")
    io = origin.get("is_originating")
    orig_txt = "Originario" if io else ("No originario" if io is not None else "—")
    rows = "".join(
        f'<tr><td class="k">{escape(k)}</td><td>{escape(str(v))}</td></tr>' for k, v in [
            ("Folio", cert.folio),
            ("Producto", f"{prod.get('sku', '')} — {prod.get('description', '')}"),
            ("Fracción (HS)", prod.get("hs") or "—"),
            ("Tratado", treaty),
            ("Origen declarado", orig_txt),
            ("Criterio", origin.get("criterion") or "—"),
            ("Proveedor (productor)", producer.get("nombre", "")),
            ("Firmado", cert.signed_at.strftime("%Y-%m-%d") if cert.signed_at else "—"),
        ])
    return _verify_page(
        f'<div class="card"><h1 class="ok">✓ Certificado de origen válido</h1>'
        f'<table>{rows}</table>'
        f'<p class="note">Verificación pública de autenticidad. LogiQ Aduanas | FTA.</p></div>')


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def bulk_template(request):
    """Descarga una plantilla .xlsx para carga masiva. ?type=products|suppliers|
    customers|bom|bom_response."""
    from django.http import HttpResponse
    from apps.origin import bulk
    t = request.query_params.get("type", "")
    if t == "bom_response":
        cols, sheet, fname = bulk.BOM_RESPONSE_COLUMNS, "Respuesta BOM", "plantilla_respuesta_bom.xlsx"
        instructions, col_help = bulk.BOM_RESPONSE_INSTRUCTIONS, bulk.BOM_RESPONSE_HELP
    elif t in bulk.SPECS:
        spec = bulk.SPECS[t]
        cols, sheet, fname = spec["columns"], spec["sheet"], f"plantilla_{t}.xlsx"
        instructions, col_help = spec.get("instructions", ""), spec.get("help", {})
    else:
        return Response({"error": "Tipo de plantilla inválido."}, status=status.HTTP_400_BAD_REQUEST)
    content = bulk.make_template(cols, sheet, instructions=instructions, col_help=col_help)
    resp = HttpResponse(content, content_type=(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
    resp["Content-Disposition"] = f'attachment; filename="{fname}"'
    return resp


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def bulk_spec(request):
    """Especificación de un layout de carga masiva, para explicarlo EN la app:
    instrucciones generales y, por columna, etiqueta/obligatoriedad/ayuda/ejemplo."""
    from apps.origin import bulk
    t = request.query_params.get("type", "")
    if t == "bom_response":
        cols, sheet = bulk.BOM_RESPONSE_COLUMNS, "Respuesta BOM"
        instructions, col_help = bulk.BOM_RESPONSE_INSTRUCTIONS, bulk.BOM_RESPONSE_HELP
    elif t == "declaration_response":
        cols, sheet = bulk.DECLARATION_RESPONSE_COLUMNS, "Declaración de origen"
        instructions, col_help = (bulk.DECLARATION_RESPONSE_INSTRUCTIONS,
                                  bulk.DECLARATION_RESPONSE_HELP)
    elif t in bulk.SPECS:
        spec = bulk.SPECS[t]
        cols, sheet = spec["columns"], spec["sheet"]
        instructions, col_help = spec.get("instructions", ""), spec.get("help", {})
    else:
        return Response({"error": "Tipo de plantilla inválido."},
                        status=status.HTTP_400_BAD_REQUEST)
    return Response({
        "sheet": sheet,
        "instructions": [p for p in (instructions or "").split("\n") if p.strip()],
        "columns": [{
            "key": key, "label": label, "example": str(example),
            "required": bool(col_help.get(key, {}).get("req")),
            "help": col_help.get(key, {}).get("help", ""),
        } for key, label, example in cols],
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def bulk_import(request):
    """Importa un .xlsx para carga masiva (solo empresa). ?type=products|suppliers|
    customers|bom. Devuelve {creados, actualizados, errores}."""
    from apps.origin import bulk
    m = active_membership(request)
    if not m or m.is_supplier:
        raise PermissionDenied("Solo la empresa puede hacer carga masiva de catálogos.")
    forbid_read_only(m, request)
    t = request.query_params.get("type", "")
    if t not in bulk.SPECS:
        return Response({"error": "Tipo de carga inválido."}, status=status.HTTP_400_BAD_REQUEST)
    f = request.FILES.get("file")
    if not f:
        return Response({"error": "Adjunta el archivo .xlsx."}, status=status.HTTP_400_BAD_REQUEST)
    spec = bulk.SPECS[t]
    try:
        rows = bulk.read_rows(f, spec["columns"])
    except Exception:
        return Response({"error": "No se pudo leer el archivo. ¿Es un .xlsx válido "
                         "con los encabezados de la plantilla?"}, status=status.HTTP_400_BAD_REQUEST)
    if not rows:
        return Response({"error": "El archivo no tiene filas con datos."},
                        status=status.HTTP_400_BAD_REQUEST)
    # Modo previsualización (no guarda): para confirmar antes de importar.
    if request.query_params.get("dry") and t == "products":
        return Response(bulk.preview_products(m.tenant, rows))
    result = spec["importer"](m.tenant, rows, request.user)
    return Response(result)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def license_view(request):
    """La EMPRESA consulta su propia licencia (vigencia, días restantes, monto de
    renovación) para el dashboard y el módulo de Licencia."""
    from apps.tenants.serializers import LicenseSerializer
    m = active_membership(request)
    if not m:
        return Response({})
    lic = getattr(m.tenant, "license", None)
    if not lic:
        return Response({})
    return Response(LicenseSerializer(lic).data)


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def company_profile_view(request):
    """La EMPRESA consulta y edita los datos de su empresa y su firma (PNG),
    que se usan para emitir/llenar los certificados de origen."""
    m = active_membership(request)
    if not m or m.is_supplier:
        raise PermissionDenied("Solo la empresa puede gestionar los datos de la empresa.")
    forbid_read_only(m, request)
    prof, created = CompanyProfile.objects.get_or_create(tenant=m.tenant)
    # La identidad (razón social y RFC) la fija el administrador de LogiQ desde el
    # alta del tenant; se siembra aquí y NO la puede cambiar el usuario de empresa
    # (evita que el sistema se use para otra empresa cambiando el nombre).
    changed = []
    if not prof.legal_name and m.tenant.name:
        prof.legal_name = m.tenant.name; changed.append("legal_name")
    if not prof.tax_id and getattr(m.tenant, "rfc", ""):
        prof.tax_id = m.tenant.rfc; changed.append("tax_id")
    if changed:
        prof.save(update_fields=changed)
    if request.method == "GET":
        return Response(s.CompanyProfileSerializer(prof).data)
    data = {k: v for k, v in request.data.items() if k not in ("legal_name", "tax_id")}
    ser = s.CompanyProfileSerializer(prof, data=data, partial=True)
    ser.is_valid(raise_exception=True)
    ser.save()
    return Response(ser.data)


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def supplier_profile_view(request):
    """El PROVEEDOR consulta y edita los datos de su empresa y su firma (PNG),
    que se usan para generar el certificado de origen."""
    m = request.user.memberships.select_related("party", "tenant").first()
    if not m or not m.is_supplier or not m.party_id:
        raise PermissionDenied("Solo el proveedor puede gestionar los datos de su empresa.")
    prof, _ = SupplierProfile.objects.get_or_create(
        party=m.party, defaults={"tenant": m.tenant})
    if request.method == "GET":
        return Response(s.SupplierProfileSerializer(prof).data)
    ser = s.SupplierProfileSerializer(prof, data=request.data, partial=True)
    ser.is_valid(raise_exception=True)
    ser.save()
    return Response(ser.data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def change_password(request):
    """El usuario autenticado define su propia contraseña (primer ingreso o cambio).
    Body: {new_password}. Apaga la bandera 'debe cambiar contraseña'."""
    new = request.data.get("new_password") or ""
    if len(new) < 6:
        return Response({"error": "La contraseña debe tener al menos 6 caracteres."},
                        status=status.HTTP_400_BAD_REQUEST)
    user = request.user
    user.set_password(new)
    user.save(update_fields=["password"])
    # El token de autenticación NO cambia: el usuario sigue logueado.
    Membership.objects.filter(user=user).update(must_change_password=False)
    UserSecurity.objects.filter(user=user).update(must_change_password=False)
    return Response({"ok": True})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    """Identidad del usuario: master, empresa o proveedor."""
    impersonating = is_impersonating(request)
    # El equipo de LogiQ (superusuario) es el perfil MASTER del SaaS. Salvo que
    # esté "abriendo" una empresa (X-As-Tenant): en ese caso responde como admin
    # de esa empresa pero conservando is_master + impersonating.
    if request.user.is_superuser and not impersonating:
        sec = UserSecurity.objects.filter(user=request.user).first()
        return Response({
            "username": request.user.username,
            "role": "master", "role_display": "Master (LogiQ)",
            "is_master": True, "is_supplier": False, "impersonating": False,
            "must_change_password": bool(sec and sec.must_change_password),
            "tenant": None, "supplier": None,
        })
    m = active_membership(request)
    if not m:
        return Response({"username": request.user.username, "role": None,
                         "is_master": request.user.is_superuser,
                         "impersonating": False, "tenant": None, "supplier": None})
    # Logo de la empresa (tenant). El proveedor ve el logo de su empresa-cliente.
    tprof = getattr(m.tenant, "profile", None)
    return Response({
        "username": (m.login_name or request.user.username) if m.is_supplier else request.user.username,
        "role": m.role,
        "role_display": m.get_role_display(),
        "is_master": request.user.is_superuser,
        "impersonating": impersonating,
        "is_supplier": m.is_supplier,
        "must_change_password": getattr(m, "must_change_password", False),
        "tenant": {"id": m.tenant_id, "name": m.tenant.name, "slug": m.tenant.slug,
                   "logo": (tprof.logo_png if tprof else "")},
        "supplier": ({"id": m.party_id, "name": m.party.name, "slug": m.party.slug}
                     if m.party_id else None),
    })


class AuditViewSet(TenantScopedViewSet):
    """Auditorías de verificación de origen (el CLIENTE audita a la empresa).
    Solo la empresa; los proveedores no ven este módulo."""
    queryset = (Audit.objects.select_related("client")
                .prefetch_related("items__product", "items__treaty",
                                  "documents__files"))
    serializer_class = s.AuditSerializer
    supplier_field = "supplier_id"  # el proveedor auditado ve las suyas

    def _require_company(self):
        m = self.membership()
        if not m or m.is_supplier:
            raise PermissionDenied("Solo la empresa gestiona auditorías.")
        return m

    def _require_member(self):
        """Empresa o proveedor auditado (el queryset ya acota a lo suyo)."""
        m = self.membership()
        if not m:
            raise PermissionDenied("Sin acceso.")
        return m

    def update(self, request, *args, **kwargs):
        self._require_company()
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        self._require_company()
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        self._require_company()
        return super().destroy(request, *args, **kwargs)

    def create(self, request, *args, **kwargs):
        """Crea la auditoría con su alcance y SIEMBRA el cuestionario estándar
        pre-llenado. Body: {title, auditor?, client?, notified_at?,
        questionnaire_due?, documents_due?, items: [{product, treaty}]}."""
        from django.utils.dateparse import parse_date
        from apps.origin.services import seed_audit
        m = self._require_company()
        d = request.data
        if not (d.get("title") or "").strip():
            return Response({"error": "Ponle un título a la auditoría."},
                            status=status.HTTP_400_BAD_REQUEST)
        items = d.get("items") or []
        if not items:
            return Response({"error": "Agrega al menos una parte al alcance."},
                            status=status.HTTP_400_BAD_REQUEST)
        kind = d.get("kind") or Audit.Kind.CLIENT
        supplier = None
        if kind == Audit.Kind.SUPPLIER:
            supplier = Party.objects.filter(tenant=m.tenant, kind=Party.Kind.SUPPLIER,
                                            pk=d.get("supplier")).first()
            if not supplier:
                return Response({"error": "Elige el proveedor auditado."},
                                status=status.HTTP_400_BAD_REQUEST)
        client = None
        if d.get("client"):
            client = Party.objects.filter(tenant=m.tenant, kind=Party.Kind.CUSTOMER,
                                          pk=d.get("client")).first()
        audit = Audit.objects.create(
            tenant=m.tenant, kind=kind, supplier=supplier, title=d["title"].strip()[:200],
            auditor=(d.get("auditor") or "").strip()[:200], client=client,
            notified_at=parse_date(d.get("notified_at") or "") or None,
            questionnaire_due=parse_date(d.get("questionnaire_due") or "") or None,
            documents_due=parse_date(d.get("documents_due") or "") or None,
            notes=(d.get("notes") or ""), created_by=request.user)
        for it in items:
            product = Product.objects.filter(tenant=m.tenant, pk=it.get("product")).first()
            treaty = Treaty.objects.filter(pk=it.get("treaty")).first()
            if product and treaty:
                AuditItem.objects.get_or_create(
                    tenant=m.tenant, audit=audit, product=product, treaty=treaty,
                    defaults={"model_name": (it.get("model_name") or "")[:60]})
        seed_audit(audit)
        return Response(s.AuditSerializer(audit).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="update-document")
    def update_document(self, request, pk=None):
        """Actualiza un renglón del cuestionario: {id, provided?, response?}.
        La empresa siempre; el proveedor auditado, en las suyas."""
        self._require_member()
        audit = self.get_object()
        doc = AuditDocument.objects.filter(audit=audit, pk=request.data.get("id")).first()
        if not doc:
            return Response({"error": "Renglón no encontrado."},
                            status=status.HTTP_400_BAD_REQUEST)
        if "provided" in request.data:
            doc.provided = bool(request.data["provided"])
        if "response" in request.data:
            doc.response = str(request.data["response"] or "")
            doc.auto_filled = False  # ya lo editó la empresa
        doc.save(update_fields=["provided", "response", "auto_filled", "updated_at"])
        return Response(s.AuditDocumentSerializer(doc).data)

    @action(detail=True, methods=["post"], url_path="upload-file")
    def upload_file(self, request, pk=None):
        """Adjunta evidencia a un renglón: {document?, filename, content_type?,
        data_b64}. El contenido vive en BD (disco del contenedor es efímero)."""
        m = self._require_member()
        audit = self.get_object()
        data_b64 = request.data.get("data_b64") or ""
        filename = (request.data.get("filename") or "archivo").strip()[:200]
        if not data_b64:
            return Response({"error": "Adjunta el archivo."},
                            status=status.HTTP_400_BAD_REQUEST)
        if len(data_b64) > 14_000_000:  # ~10 MB reales
            return Response({"error": "El archivo es muy grande (máximo ~10 MB)."},
                            status=status.HTTP_400_BAD_REQUEST)
        doc = None
        if request.data.get("document"):
            doc = AuditDocument.objects.filter(audit=audit,
                                               pk=request.data["document"]).first()
        import base64
        try:
            size = len(base64.b64decode(data_b64))
        except Exception:
            return Response({"error": "El archivo no se pudo leer (base64 inválido)."},
                            status=status.HTTP_400_BAD_REQUEST)
        f = AuditFile.objects.create(
            tenant=m.tenant, audit=audit, document=doc, filename=filename,
            content_type=(request.data.get("content_type") or "")[:120],
            size=size, data_b64=data_b64, uploaded_by=request.user)
        if doc and not doc.provided:
            doc.provided = True
            doc.save(update_fields=["provided", "updated_at"])
        return Response(s.AuditFileSerializer(f).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="delete-file")
    def delete_file(self, request, pk=None):
        self._require_member()
        audit = self.get_object()
        n, _ = AuditFile.objects.filter(audit=audit, pk=request.data.get("id")).delete()
        return Response({"ok": bool(n)})

    @action(detail=True, methods=["get"], url_path="file/(?P<file_id>[0-9]+)")
    def download_file(self, request, pk=None, file_id=None):
        """Descarga un adjunto."""
        import base64
        from django.http import HttpResponse
        self._require_member()
        audit = self.get_object()
        f = AuditFile.objects.filter(audit=audit, pk=file_id).first()
        if not f:
            return Response({"error": "Adjunto no encontrado."},
                            status=status.HTTP_404_NOT_FOUND)
        resp = HttpResponse(base64.b64decode(f.data_b64),
                            content_type=f.content_type or "application/octet-stream")
        resp["Content-Disposition"] = f'attachment; filename="{f.filename}"'
        return resp

    @action(detail=True, methods=["get"], url_path="package")
    def package(self, request, pk=None):
        """Expediente ZIP: cuestionario respondido + certificados + adjuntos."""
        from django.http import HttpResponse
        from apps.origin.services import build_audit_package
        self._require_member()
        audit = self.get_object()
        content = build_audit_package(audit)
        resp = HttpResponse(content, content_type="application/zip")
        resp["Content-Disposition"] = 'attachment; filename="expediente_auditoria.zip"'
        return resp
