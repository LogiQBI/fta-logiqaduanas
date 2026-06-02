"""Datos maestros: proveedores/clientes, productos, BOM y declaraciones de proveedor."""
from django.db import models

from apps.tenants.models import TenantOwnedModel


class Party(TenantOwnedModel):
    """Proveedores y clientes del tenant."""

    class Kind(models.TextChoices):
        SUPPLIER = "supplier", "Proveedor"
        CUSTOMER = "customer", "Cliente"

    kind = models.CharField(max_length=20, choices=Kind.choices)
    name = models.CharField("Nombre / Razón social", max_length=255)
    tax_id = models.CharField("RFC / Tax ID", max_length=30, blank=True)
    country = models.CharField("País (ISO-2)", max_length=2, help_text="Ej: MX, US, CN")
    email = models.EmailField(blank=True)
    phone = models.CharField("Teléfono", max_length=30, blank=True)

    class Meta:
        ordering = ["name"]
        verbose_name = "Proveedor/Cliente"
        verbose_name_plural = "Proveedores/Clientes"

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
    hs_code = models.CharField("Fracción arancelaria (HS)", max_length=10,
                               help_text="6 a 10 dígitos")
    unit_cost = models.DecimalField("Costo unitario", max_digits=14, decimal_places=4, default=0)
    currency = models.CharField("Moneda", max_length=3, default="USD")
    # Para materiales comprados: país de origen declarado del propio item.
    country_of_origin = models.CharField("País de origen (ISO-2)", max_length=2, blank=True)
    supplier = models.ForeignKey(
        Party, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="supplied_products", limit_choices_to={"kind": Party.Kind.SUPPLIER},
    )

    class Meta:
        unique_together = [("tenant", "sku")]
        ordering = ["sku"]
        verbose_name = "Producto / Material"
        verbose_name_plural = "Productos / Materiales"

    def __str__(self):
        return f"{self.sku} — {self.description}"


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
