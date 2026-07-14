"""Datos maestros: proveedores/clientes, productos, BOM y declaraciones de proveedor."""
from django.conf import settings
from django.db import models
from django.utils.text import slugify

from apps.catalog.uom import UOM_CHOICES
from apps.tenants.models import TenantOwnedModel, TimeStampedModel, Tenant


class Party(TenantOwnedModel):
    """Proveedores y clientes del tenant. Cada uno tiene un slug único DENTRO de
    su empresa (para identificarlo en un SaaS multi-empresa: empresa/proveedor)."""

    class Kind(models.TextChoices):
        SUPPLIER = "supplier", "Proveedor"
        CUSTOMER = "customer", "Cliente"

    kind = models.CharField(max_length=20, choices=Kind.choices)
    name = models.CharField("Nombre / Razón social", max_length=255)
    code = models.CharField("Código de proveedor", max_length=30, blank=True,
                            help_text="Clave que la empresa asigna al proveedor (ej. ST01).")
    slug = models.SlugField("Slug", max_length=140, blank=True,
                            help_text="Identificador único dentro de la empresa.")
    tax_id = models.CharField("RFC / Tax ID", max_length=30, blank=True)
    country = models.CharField("País (ISO-2)", max_length=2, help_text="Ej: MX, US, CN")
    address = models.CharField("Dirección", max_length=255, blank=True,
                               help_text="Se imprime en los documentos (ej. Importer del certificado).")
    email = models.EmailField(blank=True)
    phone = models.CharField("Teléfono", max_length=30, blank=True)

    class Meta:
        ordering = ["name"]
        unique_together = [("tenant", "slug")]
        verbose_name = "Proveedor/Cliente"
        verbose_name_plural = "Proveedores/Clientes"

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(self.name) or self.kind
            slug, i = base, 1
            while Party.objects.filter(tenant_id=self.tenant_id, slug=slug).exclude(pk=self.pk).exists():
                i += 1
                slug = f"{base}-{i}"
            self.slug = slug
        super().save(*args, **kwargs)

    @property
    def full_slug(self):
        """empresa/proveedor — identificador completo en el SaaS."""
        return f"{self.tenant.slug}/{self.slug}"

    def __str__(self):
        return f"{self.name} ({self.get_kind_display()})"


class SupplierProfile(TenantOwnedModel):
    """Datos de la empresa del PROVEEDOR (los captura él mismo) + firma en PNG.
    Se usan para generar el certificado de origen. Uno por proveedor (Party)."""

    party = models.OneToOneField(Party, on_delete=models.CASCADE, related_name="profile")
    legal_name = models.CharField("Razón social", max_length=255, blank=True)
    tax_id = models.CharField("RFC / Tax ID", max_length=30, blank=True)
    address = models.CharField("Domicilio", max_length=255, blank=True)
    city = models.CharField("Ciudad", max_length=120, blank=True)
    state = models.CharField("Estado / Provincia", max_length=120, blank=True)
    postal_code = models.CharField("Código postal", max_length=20, blank=True)
    country = models.CharField("País (ISO-3)", max_length=3, blank=True,
                               help_text="Tres letras, ej. MEX, USA, CHN.")
    contact_name = models.CharField("Nombre de contacto", max_length=255, blank=True)
    contact_email = models.EmailField("Correo de contacto", blank=True)
    contact_phone = models.CharField("Teléfono de contacto", max_length=30, blank=True)
    signatory_name = models.CharField("Nombre de quien firma", max_length=255, blank=True)
    signatory_title = models.CharField("Cargo de quien firma", max_length=120, blank=True)
    # PNG en base64 (data URL). Railway tiene almacenamiento efímero -> en BD.
    signature_png = models.TextField("Firma (PNG en base64)", blank=True)

    class Meta:
        verbose_name = "Datos del proveedor"
        verbose_name_plural = "Datos del proveedor"

    def __str__(self):
        return f"Datos de {self.party.name}"


class CompanyProfile(TimeStampedModel):
    """Datos de la EMPRESA (tenant) + firma en PNG, para llenar los certificados
    de origen que la empresa emite a sus clientes. Uno por empresa."""

    tenant = models.OneToOneField(Tenant, on_delete=models.CASCADE, related_name="profile")
    legal_name = models.CharField("Razón social", max_length=255, blank=True)
    tax_id = models.CharField("RFC / Tax ID", max_length=30, blank=True)
    address = models.CharField("Domicilio", max_length=255, blank=True)
    city = models.CharField("Ciudad", max_length=120, blank=True)
    state = models.CharField("Estado / Provincia", max_length=120, blank=True)
    postal_code = models.CharField("Código postal", max_length=20, blank=True)
    country = models.CharField("País (ISO-3)", max_length=3, blank=True,
                               help_text="Tres letras, ej. MEX, USA, CAN.")
    contact_name = models.CharField("Nombre de contacto", max_length=255, blank=True)
    contact_email = models.EmailField("Correo de contacto", blank=True)
    contact_phone = models.CharField("Teléfono de contacto", max_length=30, blank=True)
    signatory_name = models.CharField("Nombre de quien firma", max_length=255, blank=True)
    signatory_title = models.CharField("Cargo de quien firma", max_length=120, blank=True)
    signature_png = models.TextField("Firma (PNG en base64)", blank=True)
    # Logo de la empresa (PNG/data URI en base64). Aparece en la barra superior;
    # el proveedor ve el logo de su empresa-cliente. Railway tiene almacenamiento
    # efímero -> se guarda en BD.
    logo_png = models.TextField("Logo (PNG en base64)", blank=True)

    class Meta:
        verbose_name = "Datos de la empresa"
        verbose_name_plural = "Datos de la empresa"

    def __str__(self):
        return f"Datos de {self.tenant.name}"


class Product(TenantOwnedModel):
    """Parte, material o producto terminado. Un producto puede tener BOM (subniveles)."""

    class Kind(models.TextChoices):
        MATERIAL = "material", "Material / Insumo"
        SUBASSEMBLY = "subassembly", "Subensamble"
        FINISHED = "finished", "Producto terminado"

    sku = models.CharField("SKU / Núm. de parte", max_length=100)
    description = models.CharField("Descripción", max_length=255)
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.FINISHED)
    hs_code = models.CharField("Fracción arancelaria (HS)", max_length=10, blank=True,
                               help_text="6 a 10 dígitos")
    unit_cost = models.DecimalField("Costo unitario", max_digits=14, decimal_places=4, default=0)
    # Mano de obra directa + gastos indirectos de fabricación (costos de conversión)
    # del bien terminado. Es valor agregado REGIONAL (originario): suma al costo neto
    # del bien para el VCR, pero NO cuenta como material no originario (VNM).
    conversion_cost = models.DecimalField(
        "Mano de obra y costos de conversión", max_digits=14, decimal_places=4, default=0,
        help_text="Mano de obra directa + indirectos de fabricación. Suma al costo neto "
                  "del bien (valor regional originario); sube el VCR.")
    currency = models.CharField("Moneda", max_length=3, default="USD")
    # Para materiales comprados: país de origen declarado del propio item.
    country_of_origin = models.CharField("País de origen (ISO-2)", max_length=2, blank=True)
    is_active = models.BooleanField("Activo", default=True,
                                    help_text="Insumos inactivos no se usan en cálculos ni solicitudes.")
    supplier = models.ForeignKey(
        Party, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="supplied_products", limit_choices_to={"kind": Party.Kind.SUPPLIER},
    )
    # Clientes a los que la empresa VENDE esta parte. Sirve para filtrar los
    # números de parte por cliente al emitir certificados / declarar origen.
    customers = models.ManyToManyField(
        Party, blank=True, related_name="purchased_products",
        limit_choices_to={"kind": Party.Kind.CUSTOMER},
    )
    # Sugerencia de fracción del proveedor (la empresa la acepta o rechaza).
    class HsSuggestion(models.TextChoices):
        PENDING = "pending", "Pendiente"
        ACCEPTED = "accepted", "Aceptada"
        REJECTED = "rejected", "Rechazada"

    hs_suggested = models.CharField("Fracción sugerida por proveedor", max_length=10, blank=True)
    hs_suggestion_status = models.CharField(max_length=10, blank=True,
                                            choices=HsSuggestion.choices)
    hs_suggestion_note = models.CharField("Comentario de la sugerencia", max_length=255, blank=True)
    hs_suggested_by = models.ForeignKey(
        Party, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="hs_suggestions")

    class Meta:
        unique_together = [("tenant", "sku")]
        ordering = ["sku"]
        verbose_name = "Producto / Material"
        verbose_name_plural = "Productos / Materiales"

    def __str__(self):
        return f"{self.sku} — {self.description}"


class HsChangeLog(TenantOwnedModel):
    """Bitácora de cambios de fracción arancelaria (sugerencias de proveedor
    aceptadas o rechazadas por la empresa)."""

    product = models.ForeignKey("catalog.Product", on_delete=models.CASCADE, related_name="hs_logs")
    old_hs = models.CharField("Fracción anterior", max_length=10, blank=True)
    new_hs = models.CharField("Fracción nueva", max_length=10, blank=True)
    suggested_by = models.CharField("Sugerida por (proveedor)", max_length=255, blank=True)
    action = models.CharField("Acción", max_length=10)  # accepted / rejected
    note = models.CharField("Comentario", max_length=255, blank=True)
    decided_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                   on_delete=models.SET_NULL)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Cambio de fracción"
        verbose_name_plural = "Cambios de fracción"

    def __str__(self):
        return f"{self.product.sku}: {self.old_hs} -> {self.new_hs} ({self.action})"


class ProductChangeLog(TenantOwnedModel):
    """Histórico de cambios de PRECIO y de PAÍS DE ORIGEN de un número de parte.
    Los precios cambian de manera recurrente; cada cambio (manual, por carga masiva
    o por el proveedor) queda registrado con valor anterior → nuevo, fuente y autor,
    para auditoría y para ver la evolución en el catálogo (empresa y proveedor)."""

    class Kind(models.TextChoices):
        PRICE = "price", "Precio"
        ORIGIN = "origin", "País de origen"

    class Source(models.TextChoices):
        MANUAL = "manual", "Edición manual"
        BULK = "bulk", "Carga masiva"
        SUPPLIER = "supplier", "Proveedor"

    product = models.ForeignKey("catalog.Product", on_delete=models.CASCADE,
                                related_name="change_logs")
    kind = models.CharField("Tipo de cambio", max_length=10, choices=Kind.choices)
    # Representación legible (para ambos tipos); ej. "30.00 USD" o "KR".
    old_value = models.CharField("Valor anterior", max_length=60, blank=True)
    new_value = models.CharField("Valor nuevo", max_length=60, blank=True)
    # Solo para kind=PRICE: valores numéricos + moneda (para ordenar/graficar).
    old_price = models.DecimalField("Precio anterior", max_digits=14, decimal_places=4,
                                    null=True, blank=True)
    new_price = models.DecimalField("Precio nuevo", max_digits=14, decimal_places=4,
                                    null=True, blank=True)
    currency = models.CharField("Moneda", max_length=3, blank=True)
    source = models.CharField("Origen del cambio", max_length=10, choices=Source.choices,
                              default=Source.MANUAL)
    changed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                   on_delete=models.SET_NULL)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Cambio de precio/origen"
        verbose_name_plural = "Cambios de precio/origen"
        indexes = [models.Index(fields=["product", "kind", "-created_at"])]

    def __str__(self):
        return f"{self.product.sku} [{self.get_kind_display()}]: {self.old_value} → {self.new_value}"


def log_product_changes(*, product, before, after, source, user=None):
    """Compara los valores ANTES/DESPUÉS de un producto y registra en
    ProductChangeLog los cambios de precio y/o país de origen.

    `before`/`after` son dicts con claves opcionales `unit_cost`, `currency`,
    `country_of_origin`. Si una clave no viene en ambos, ese aspecto se ignora
    (p. ej. el proveedor solo cambia el país). Solo registra cuando hay un cambio
    REAL: el precio se compara a la precisión del campo (4 decimales), de modo que
    11.2070 y 11.207008 NO cuentan como cambio. Devuelve los logs creados."""
    from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

    # Precisión real con la que se guarda el precio (decimales del campo unit_cost).
    try:
        dp = product._meta.get_field("unit_cost").decimal_places
    except Exception:
        dp = 4
    quantum = Decimal(1).scaleb(-dp)  # p. ej. Decimal("0.0001")

    def _dec(v):
        try:
            d = Decimal(str(v)) if v not in (None, "") else None
        except (InvalidOperation, ValueError):
            return None
        return d.quantize(quantum, rounding=ROUND_HALF_UP) if d is not None else None

    def _money(d):
        # "11.2070" sin notación científica ni ceros engañosos.
        return format(d, "f") if d is not None else ""

    logs = []
    ob, oa = _dec(before.get("unit_cost")), _dec(after.get("unit_cost"))
    bcur, acur = (before.get("currency") or ""), (after.get("currency") or "")
    if ob is not None and oa is not None and (ob != oa or bcur != acur):
        logs.append(ProductChangeLog(
            tenant_id=product.tenant_id, product=product, kind=ProductChangeLog.Kind.PRICE,
            old_price=ob, new_price=oa, currency=acur or bcur,
            old_value=f"{_money(ob)} {bcur}".strip(), new_value=f"{_money(oa)} {acur}".strip(),
            source=source, changed_by=user))
    if "country_of_origin" in before and "country_of_origin" in after:
        bco, aco = (before.get("country_of_origin") or ""), (after.get("country_of_origin") or "")
        if bco != aco:
            logs.append(ProductChangeLog(
                tenant_id=product.tenant_id, product=product, kind=ProductChangeLog.Kind.ORIGIN,
                old_value=bco, new_value=aco, source=source, changed_by=user))
    if logs:
        ProductChangeLog.objects.bulk_create(logs)
    return logs


class BOMComponent(TenantOwnedModel):
    """Línea de lista de materiales: un producto padre se compone de componentes.
    Como el componente es a su vez un Product, el BOM puede ser multinivel.

    Para el cálculo de origen de la EMPRESA, cada componente define DE DÓNDE sale
    su información de origen (toggle):
      - SUPPLIER: de la declaración que el proveedor entregó (la más reciente o la
        de un periodo concreto vía `origin_as_of`).
      - MANUAL: la empresa la captura a mano (`manual_is_originating`/`manual_country`).
    """

    class OriginMode(models.TextChoices):
        SUPPLIER = "supplier", "Declaración del proveedor"
        MANUAL = "manual", "Captura manual de la empresa"

    parent = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="bom_components")
    component = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="used_in")
    quantity = models.DecimalField("Cantidad", max_digits=14, decimal_places=4, default=1)
    uom = models.CharField("Unidad de medida", max_length=2, blank=True, choices=UOM_CHOICES,
                           help_text="Código de 2 caracteres (ej. PZ, KG, MT).")

    origin_mode = models.CharField("Fuente de origen", max_length=20,
                                   choices=OriginMode.choices, default=OriginMode.SUPPLIER)
    # Si está vacío y el modo es SUPPLIER, se toma la declaración MÁS RECIENTE.
    # Si tiene fecha, se toma la declaración vigente en ese periodo.
    origin_as_of = models.DateField("Periodo (fecha) de la declaración", null=True, blank=True)
    # Captura manual (cuando origin_mode = MANUAL).
    manual_is_originating = models.BooleanField("¿Originario? (manual)", default=False)
    manual_country = models.CharField("País de origen (manual, ISO-2)", max_length=2, blank=True)

    class Meta:
        verbose_name = "Componente de BOM"
        verbose_name_plural = "Componentes de BOM"

    def __str__(self):
        return f"{self.parent.sku} ⊃ {self.component.sku} ×{self.quantity}"


class SupplierDeclaration(TenantOwnedModel):
    """Declaración de origen que un proveedor entrega sobre un material, por tratado.
    Es la pieza que alimenta el portal de proveedores (solicitud de origen)."""

    supplier = models.ForeignKey(Party, on_delete=models.CASCADE, related_name="declarations",
                                 limit_choices_to={"kind": Party.Kind.SUPPLIER})
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="declarations")
    treaty = models.ForeignKey("treaties.Treaty", on_delete=models.CASCADE, related_name="declarations")
    is_originating = models.BooleanField("¿Es originario para el tratado?", default=False)
    country_of_origin = models.CharField("País de origen (ISO-2)", max_length=2, blank=True)
    rule = models.ForeignKey("treaties.OriginRule", null=True, blank=True,
                             on_delete=models.SET_NULL, related_name="declarations")
    value_originating = models.DecimalField("Valor de materiales originarios",
                                            max_digits=14, decimal_places=4, default=0)
    value_non_originating = models.DecimalField("Valor de materiales no originarios",
                                                max_digits=14, decimal_places=4, default=0)
    valid_from = models.DateField("Vigente desde")
    valid_to = models.DateField("Vigente hasta")

    class Meta:
        verbose_name = "Declaración de proveedor"
        verbose_name_plural = "Declaraciones de proveedor"

    def __str__(self):
        estado = "originario" if self.is_originating else "no originario"
        return f"{self.product.sku} / {self.treaty.code}: {estado}"


def _new_token():
    import secrets
    return secrets.token_urlsafe(32)


class SolicitationRequest(TenantOwnedModel):
    """Solicitud que la empresa envía a un proveedor para que declare el origen
    de un material, por tratado. El proveedor responde en un portal tokenizado
    (sin necesidad de cuenta). Al responder se crea la SupplierDeclaration."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pendiente de enviar"
        SENT = "sent", "Enviada al proveedor"
        RESPONDED = "responded", "Respondida"
        ACCEPTED = "accepted", "Aceptada por cliente"
        REJECTED = "rejected", "Rechazada por cliente"
        EXPIRED = "expired", "Vencida"

    class Period(models.TextChoices):
        MONTH = "month", "Mensual"
        SEMESTER = "semester", "Semestral"
        YEAR = "year", "Anual"
        CUSTOM = "custom", "Personalizado"

    supplier = models.ForeignKey(Party, on_delete=models.CASCADE, related_name="solicitations",
                                 limit_choices_to={"kind": Party.Kind.SUPPLIER})
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="solicitations")
    treaty = models.ForeignKey("treaties.Treaty", on_delete=models.CASCADE, related_name="solicitations")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    # Periodo de cobertura del origen solicitado.
    period_type = models.CharField("Periodo", max_length=20, choices=Period.choices, blank=True)
    period_from = models.DateField("Periodo desde", null=True, blank=True)
    period_to = models.DateField("Periodo hasta", null=True, blank=True)
    # Si está activo, el proveedor debe subir el BOM (lista de materiales) en vez
    # de solo declarar origen. El cálculo de origen se hace en otro módulo.
    bom_analysis = models.BooleanField("Análisis por BOM", default=False)
    rejection_reason = models.TextField("Motivo de rechazo", blank=True)
    token = models.CharField(max_length=64, unique=True, default=_new_token, editable=False)
    due_date = models.DateField("Fecha límite", null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    responded_at = models.DateTimeField(null=True, blank=True)
    declaration = models.ForeignKey(SupplierDeclaration, null=True, blank=True,
                                    on_delete=models.SET_NULL, related_name="solicitation")

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Solicitud a proveedor"
        verbose_name_plural = "Solicitudes a proveedor"

    def __str__(self):
        return f"Solicitud {self.product.sku} → {self.supplier.name} ({self.get_status_display()})"

    @property
    def portal_path(self):
        return f"/portal/{self.token}/"


class RuleDisplay(TenantOwnedModel):
    """Override COSMÉTICO por empresa de cómo se muestra un PSR (ej. 'CTH' en vez
    de 'CC'). NO cambia el cálculo de origen: el motor usa siempre la regla oficial."""

    rule = models.ForeignKey("treaties.OriginRule", on_delete=models.CASCADE,
                             related_name="displays")
    display_type = models.CharField("Tipo/código a mostrar", max_length=60, blank=True)
    display_description = models.CharField("Descripción a mostrar", max_length=255, blank=True)

    class Meta:
        unique_together = [("tenant", "rule")]
        verbose_name = "Presentación de regla (empresa)"
        verbose_name_plural = "Presentaciones de regla (empresa)"

    def __str__(self):
        return f"{self.tenant.slug}: {self.rule_id} -> {self.display_type}"


class SolicitationLog(TenantOwnedModel):
    """Bitácora de eventos de una solicitud (guardar BOM, calcular, enviar,
    traer info de periodo anterior, etc.)."""

    solicitation = models.ForeignKey("catalog.SolicitationRequest",
                                     on_delete=models.CASCADE, related_name="logs")
    action = models.CharField("Acción", max_length=30)
    detail = models.CharField("Detalle", max_length=255, blank=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                             on_delete=models.SET_NULL)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Evento de solicitud"
        verbose_name_plural = "Eventos de solicitud"

    def __str__(self):
        return f"{self.solicitation_id}: {self.action}"


class SolicitationBOM(TenantOwnedModel):
    """BOM (lista de materiales) que el proveedor sube como respuesta a una
    solicitud con análisis por BOM. El cálculo de origen se hace aparte."""

    solicitation = models.OneToOneField(
        SolicitationRequest, on_delete=models.CASCADE, related_name="bom")
    # Regla de origen específica (PSR) elegida por el proveedor, del catálogo
    # global que administra LogiQ (apps.treaties.OriginRule).
    rule = models.ForeignKey("treaties.OriginRule", null=True, blank=True,
                             on_delete=models.SET_NULL, related_name="solicitation_boms")
    notes = models.TextField("Notas", blank=True)

    class RvcMethod(models.TextChoices):
        TRANSACTION = "transaction", "Valor de transacción"
        NET_COST = "net_cost", "Costo neto"

    rvc_method = models.CharField("Método VCR", max_length=20,
                                  choices=RvcMethod.choices, default=RvcMethod.TRANSACTION)
    net_cost = models.DecimalField("Costo neto", max_digits=14, decimal_places=4, default=0)
    # Resultado del cálculo de origen (se llena al presionar "Calcular origen").
    origin_status = models.CharField("Resultado de origen", max_length=20, blank=True)
    criterion = models.CharField("Criterio aplicado", max_length=20, blank=True)
    rvc_value = models.DecimalField("VCR (%)", max_digits=6, decimal_places=2, null=True, blank=True)
    detail = models.JSONField("Traza del cálculo", default=dict, blank=True)
    computed_at = models.DateTimeField("Calculado el", null=True, blank=True)

    class Meta:
        verbose_name = "BOM de solicitud"
        verbose_name_plural = "BOMs de solicitud"

    def __str__(self):
        return f"BOM de {self.solicitation}"


class SolicitationBOMLine(TenantOwnedModel):
    """Línea de detalle del BOM que captura el proveedor (un componente)."""

    bom = models.ForeignKey(SolicitationBOM, on_delete=models.CASCADE, related_name="lines")
    part_number = models.CharField("Número de parte", max_length=100)
    description = models.CharField("Descripción", max_length=255, blank=True)
    hs_code = models.CharField("Fracción arancelaria (HS)", max_length=10, blank=True,
                               help_text="Necesaria para evaluar el salto arancelario (CTH).")
    unit_price = models.DecimalField("Precio unitario", max_digits=14, decimal_places=4, default=0)
    quantity = models.DecimalField("Cantidad utilizada", max_digits=14, decimal_places=4, default=0)
    uom = models.CharField("Unidad de medida", max_length=2, blank=True, choices=UOM_CHOICES,
                           help_text="Código de 2 caracteres (ej. PZ, KG, MT).")
    country = models.CharField("País de origen (ISO-2)", max_length=2, blank=True)
    has_origin_evidence = models.BooleanField(
        "¿Tiene certificado/evidencia de origen?", default=False,
        help_text="Si no, queda sujeto a auditorías internas.")

    class Meta:
        verbose_name = "Línea de BOM de solicitud"
        verbose_name_plural = "Líneas de BOM de solicitud"

    @property
    def total(self):
        return (self.unit_price or 0) * (self.quantity or 0)

    def __str__(self):
        return f"{self.part_number} ×{self.quantity}"
