"""API REST con aislamiento por tenant Y por rol (empresa vs proveedor).

- Usuarios de empresa (admin/analyst/auditor): ven todo lo de su tenant.
- Usuarios proveedor (role=supplier): ven SOLO los registros de su propia Party.
"""
import secrets
import string

from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Count, ProtectedError, Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.authtoken.models import Token
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from apps.catalog.models import (
    BOMComponent, CompanyProfile, HsChangeLog, Party, Product, ProductChangeLog,
    RuleDisplay, SolicitationBOM, SolicitationBOMLine, SolicitationLog,
    SolicitationRequest, SupplierDeclaration, SupplierProfile, log_product_changes,
)
from apps.catalog.uom import clean_uom
from apps.catalog.services import generate_solicitations
from apps.origin import serializers as s
from apps.origin import automotive as auto
from apps.origin import layouts as client_layouts
from apps.origin.models import (
    AutomotiveAssessment, Certificate, ClientOriginLayout, Qualification,
    SolicitationCertificate,
)
from apps.origin.services import (
    calculate_bom_origin, calculate_product_origin, certificate_elements,
    ensure_solicitation_certificate, issue_certificate, qualify_and_save,
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


class TenantScopedViewSet(viewsets.ModelViewSet):
    """Acota por tenant y, si el usuario es proveedor, por su Party.

    `supplier_field`: nombre del campo que liga el modelo con la Party del
    proveedor. Si es None, los usuarios proveedor NO ven nada de este modelo.
    """

    supplier_field = None
    pagination_class = CatalogPagination

    def membership(self):
        return self.request.user.memberships.select_related("party").first()

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
        return self.request.user.memberships.select_related("tenant").first()

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
        return super().get_queryset().annotate(
            _change_log_count=Count("change_logs", distinct=True))

    def perform_create(self, serializer):
        """El alta de productos es solo para usuarios de empresa.
        El tenant se toma de la membresía (no se confía en el cliente)."""
        m = self.membership()
        if not m or m.is_supplier:
            raise PermissionDenied("Solo usuarios de empresa pueden crear productos.")
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
        from apps.origin.services import _resolve_component_origin
        product = self.get_object()
        treaty_id = request.query_params.get("treaty")
        treaty = Treaty.objects.filter(pk=treaty_id).first() if treaty_id else None
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
        return Response({"product": s.ProductSerializer(product).data, "components": comps,
                         "treaty_members": (treaty.member_countries if treaty else []),
                         "total_value": str(total), "vnm": str(vnm)})

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
            transaction_value=d.get("transaction_value"))
        AutomotiveAssessment.objects.update_or_create(
            tenant=m.tenant, product=product, treaty=treaty,
            defaults={"vehicle_class": vclass, "as_of": as_of,
                      "net_cost": d.get("net_cost") or 0, "vnm": d.get("vnm") or 0,
                      "lvc_pct": d.get("lvc_pct") or 0, "wage_usd_h": d.get("wage_usd_h") or 0,
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
        return qs.order_by("id")

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


class CertificateViewSet(TenantScopedViewSet):
    queryset = Certificate.objects.select_related(
        "qualification__product", "qualification__treaty").order_by("-issued_at")
    serializer_class = s.CertificateSerializer
    # los proveedores no ven certificados (None)

    @action(detail=True, methods=["get"])
    def elements(self, request, pk=None):
        """Devuelve los 9 elementos mínimos del T-MEC para impresión."""
        return Response(certificate_elements(self.get_object()))

    @action(detail=False, methods=["post"])
    def emit(self, request):
        """La EMPRESA emite y REGISTRA un certificado de origen (con folio) para
        un producto que CALIFICA en un tratado, dirigido a un cliente.
        Body: {product, treaty, client, blanket_from?, blanket_to?}."""
        from django.utils.dateparse import parse_date

        from apps.origin.services import _next_folio
        m = self.membership()
        if not m or m.is_supplier:
            raise PermissionDenied("Solo la empresa puede emitir certificados.")
        product = Product.objects.filter(tenant=m.tenant, pk=request.data.get("product")).first()
        treaty = Treaty.objects.filter(pk=request.data.get("treaty")).first()
        client = Party.objects.filter(tenant=m.tenant, kind=Party.Kind.CUSTOMER,
                                      pk=request.data.get("client")).first()
        if not (product and treaty and client):
            return Response({"error": "Selecciona producto, tratado y cliente válidos."},
                            status=status.HTTP_400_BAD_REQUEST)
        qual = Qualification.objects.filter(tenant=m.tenant, product=product, treaty=treaty).first()
        if not qual or qual.status != Qualification.Status.QUALIFIES:
            return Response({"error": "Primero calcula el origen en “Cálculo de origen” y "
                             "asegúrate de que el producto CALIFIQUE para este tratado."},
                            status=status.HTTP_400_BAD_REQUEST)
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
                    "email": client.email, "telefono": client.phone}
        cert = Certificate.objects.create(
            tenant=m.tenant, qualification=qual, folio=_next_folio(m.tenant),
            verify_token=secrets.token_urlsafe(16),
            certifier_type=Certificate.CertifierType.PRODUCER,
            certifier_data=certifier, exporter_data=certifier, producer_data=certifier,
            importer_data=importer,
            blanket_from=parse_date(request.data.get("blanket_from") or "") or None,
            blanket_to=parse_date(request.data.get("blanket_to") or "") or None,
            issued_by=request.user)
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
        body = ('<div class="card"><h1 class="bad">Certificado no encontrado</h1>'
                '<p>El código no corresponde a ningún certificado emitido en LogiQ Aduanas | FTA.</p></div>')
    else:
        q = cert.qualification
        ce = cert.certifier_data or {}
        im = cert.importer_data or {}
        treaty = s.TREATY_LABELS.get(q.treaty.code, q.treaty.code)
        rows = "".join(
            f'<tr><td class="k">{escape(k)}</td><td>{escape(str(v))}</td></tr>' for k, v in [
                ("Folio", cert.folio),
                ("Producto", f"{q.product.sku} — {q.product.description}"),
                ("Fracción (HS)", q.product.hs_code or "—"),
                ("Tratado", treaty),
                ("Criterio de origen", q.criterion or q.status),
                ("Exportador / Productor", ce.get("nombre", cert.tenant.name)),
                ("Importador", im.get("nombre", "—")),
                ("Emitido", cert.issued_at.strftime("%Y-%m-%d")),
            ])
        body = (f'<div class="card"><h1 class="ok">✓ Certificado válido</h1>'
                f'<table>{rows}</table>'
                f'<p class="note">Verificación pública de autenticidad. LogiQ Aduanas | FTA.</p></div>')
    html = (f'<!doctype html><html lang="es"><head><meta charset="utf-8">'
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


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def bulk_import(request):
    """Importa un .xlsx para carga masiva (solo empresa). ?type=products|suppliers|
    customers|bom. Devuelve {creados, actualizados, errores}."""
    from apps.origin import bulk
    m = request.user.memberships.select_related("tenant").first()
    if not m or m.is_supplier:
        raise PermissionDenied("Solo la empresa puede hacer carga masiva de catálogos.")
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
    m = request.user.memberships.select_related("tenant__license").first()
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
    m = request.user.memberships.select_related("tenant").first()
    if not m or m.is_supplier:
        raise PermissionDenied("Solo la empresa puede gestionar los datos de la empresa.")
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
    return Response({"ok": True})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    """Identidad del usuario: master, empresa o proveedor."""
    # El equipo de LogiQ (superusuario) es el perfil MASTER del SaaS.
    if request.user.is_superuser:
        return Response({
            "username": request.user.username,
            "role": "master", "role_display": "Master (LogiQ)",
            "is_master": True, "is_supplier": False,
            "tenant": None, "supplier": None,
        })
    m = request.user.memberships.select_related("tenant", "party", "tenant__profile").first()
    if not m:
        return Response({"username": request.user.username, "role": None,
                         "is_master": False, "tenant": None, "supplier": None})
    # Logo de la empresa (tenant). El proveedor ve el logo de su empresa-cliente.
    tprof = getattr(m.tenant, "profile", None)
    return Response({
        "username": (m.login_name or request.user.username) if m.is_supplier else request.user.username,
        "role": m.role,
        "role_display": m.get_role_display(),
        "is_master": False,
        "is_supplier": m.is_supplier,
        "must_change_password": m.must_change_password,
        "tenant": {"id": m.tenant_id, "name": m.tenant.name, "slug": m.tenant.slug,
                   "logo": (tprof.logo_png if tprof else "")},
        "supplier": ({"id": m.party_id, "name": m.party.name, "slug": m.party.slug}
                     if m.party_id else None),
    })
