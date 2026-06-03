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
from django.db.models import ProtectedError, Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.authtoken.models import Token
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from apps.catalog.models import (
    BOMComponent, Party, Product, SolicitationBOM, SolicitationBOMLine,
    SolicitationRequest, SupplierDeclaration,
)
from apps.catalog.services import generate_solicitations
from apps.origin import serializers as s
from apps.origin.models import Certificate, Qualification
from apps.origin.services import (
    calculate_bom_origin, certificate_elements, issue_certificate, qualify_and_save,
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


class TenantScopedViewSet(viewsets.ModelViewSet):
    """Acota por tenant y, si el usuario es proveedor, por su Party.

    `supplier_field`: nombre del campo que liga el modelo con la Party del
    proveedor. Si es None, los usuarios proveedor NO ven nada de este modelo.
    """

    supplier_field = None

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


class OriginRuleViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = OriginRule.objects.select_related("treaty").all()
    serializer_class = s.OriginRuleSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        treaty = self.request.query_params.get("treaty")
        hs = self.request.query_params.get("hs")
        if treaty:
            qs = qs.filter(treaty_id=treaty)
        if hs:
            # PSR aplicables: el patrón HS de la regla es prefijo de la fracción.
            digits = lambda x: "".join(c for c in (x or "") if c.isdigit())
            hsd = digits(hs)
            ids = [r.id for r in qs if hsd.startswith(digits(r.hs_pattern))]
            qs = qs.filter(id__in=ids)
        return qs


class PartyViewSet(TenantScopedViewSet):
    queryset = Party.objects.all()
    serializer_class = s.PartySerializer
    supplier_field = "id"  # el proveedor solo se ve a sí mismo

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
        serializer.save()

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


class BOMComponentViewSet(TenantScopedViewSet):
    queryset = BOMComponent.objects.all()
    serializer_class = s.BOMComponentSerializer
    # supplier_field = None -> los proveedores no ven el BOM de la empresa


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
    queryset = Certificate.objects.select_related("qualification__product").all()
    serializer_class = s.CertificateSerializer
    # los proveedores no ven certificados (None)

    @action(detail=True, methods=["get"])
    def elements(self, request, pk=None):
        """Devuelve los 9 elementos mínimos del T-MEC para impresión."""
        return Response(certificate_elements(self.get_object()))


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
                bom_analysis=bom_analysis))
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
                    country=(ln.get("country") or "").strip().upper()[:2],
                    has_origin_evidence=bool(ln.get("has_origin_evidence")))
            sr.status = SolicitationRequest.Status.RESPONDED
            sr.responded_at = timezone.now()
            sr.save(update_fields=["status", "responded_at", "updated_at"])
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
        if sr.status == SolicitationRequest.Status.RESPONDED:
            return Response({"error": "Esta solicitud ya fue respondida."},
                            status=status.HTTP_400_BAD_REQUEST)
        d = request.data
        # Si el proveedor no indica vigencia, se usa el periodo que pidió la empresa.
        valid_from = d.get("valid_from") or sr.period_from
        valid_to = d.get("valid_to") or sr.period_to
        if not valid_from or not valid_to:
            return Response({"error": "Faltan las fechas de vigencia."},
                            status=status.HTTP_400_BAD_REQUEST)
        decl = SupplierDeclaration.objects.create(
            tenant=sr.tenant, supplier=sr.supplier, product=sr.product, treaty=sr.treaty,
            is_originating=bool(d.get("is_originating")),
            country_of_origin=d.get("country_of_origin", ""),
            valid_from=valid_from, valid_to=valid_to,
        )
        sr.declaration = decl
        sr.status = SolicitationRequest.Status.RESPONDED
        sr.responded_at = timezone.now()
        sr.save(update_fields=["declaration", "status", "responded_at", "updated_at"])
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
            return Response(
                {"error": f"La licencia de {m.tenant.name} está "
                          f"{lic.get_status_display().lower()}. Contacta a LogiQ."},
                status=status.HTTP_403_FORBIDDEN)
    token, _ = Token.objects.get_or_create(user=user)
    return Response({"token": token.key})


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
    m = request.user.memberships.select_related("tenant", "party").first()
    if not m:
        return Response({"username": request.user.username, "role": None,
                         "is_master": False, "tenant": None, "supplier": None})
    return Response({
        "username": (m.login_name or request.user.username) if m.is_supplier else request.user.username,
        "role": m.role,
        "role_display": m.get_role_display(),
        "is_master": False,
        "is_supplier": m.is_supplier,
        "must_change_password": m.must_change_password,
        "tenant": {"id": m.tenant_id, "name": m.tenant.name, "slug": m.tenant.slug},
        "supplier": ({"id": m.party_id, "name": m.party.name, "slug": m.party.slug}
                     if m.party_id else None),
    })
