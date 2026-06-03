"""Datos maestros: proveedores/clientes, productos, BOM y declaraciones de proveedor."""
from django.conf import settings
from django.db import models
from django.utils.text import slugify

from apps.tenants.models import TenantOwnedModel


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
    currency = models.CharField("Moneda", max_length=3, default="USD")
    # Para materiales comprados: país de origen declarado del propio item.
    country_of_origin = models.CharField("País de origen (ISO-2)", max_length=2, blank=True)
    is_active = models.BooleanField("Activo", default=True,
                                    help_text="Insumos inactivos no se usan en cálculos ni solicitudes.")
    supplier = models.ForeignKey(
        Party, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="supplied_products", limit_choices_to={"kind": Party.Kind.SUPPLIER},
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


class BOMComponent(TenantOwnedModel):
    """Línea de lista de materiales: un producto padre se compone de componentes.
    Como el componente es a su vez un Product, el BOM puede ser multinivel."""

    parent = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="bom_components")
    component = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="used_in")
    quantity = models.DecimalField("Cantidad", max_digits=14, decimal_places=4, default=1)

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
