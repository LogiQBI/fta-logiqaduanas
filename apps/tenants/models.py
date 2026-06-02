"""Multitenancy: empresas (tenants), membresías y modelos base."""
from django.conf import settings
from django.db import models


class TimeStampedModel(models.Model):
    """Base con marcas de tiempo para todos los modelos."""

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Tenant(TimeStampedModel):
    """Empresa cliente del sistema. Unidad de aislamiento multitenant."""

    name = models.CharField("Razón social", max_length=255)
    rfc = models.CharField("RFC", max_length=13, blank=True)
    slug = models.SlugField(unique=True)
    is_active = models.BooleanField("Activo", default=True)

    class Meta:
        verbose_name = "Empresa (tenant)"
        verbose_name_plural = "Empresas (tenants)"

    def __str__(self):
        return self.name


class TenantOwnedModel(TimeStampedModel):
    """Base para todo modelo que pertenece a un tenant (aislamiento por empresa)."""

    tenant = models.ForeignKey(
        Tenant, on_delete=models.CASCADE, related_name="%(class)ss"
    )

    class Meta:
        abstract = True


class Membership(TimeStampedModel):
    """Vincula un usuario con una empresa y su rol dentro de ella."""

    class Role(models.TextChoices):
        ADMIN = "admin", "Administrador"
        ANALYST = "analyst", "Analista de origen"
        SUPPLIER = "supplier", "Proveedor"
        AUDITOR = "auditor", "Auditor"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships"
    )
    tenant = models.ForeignKey(
        Tenant, on_delete=models.CASCADE, related_name="memberships"
    )
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.ANALYST)
    # Si el rol es SUPPLIER, este usuario representa a esta empresa proveedora
    # y solo podrá ver/editar los datos de esa Party.
    party = models.ForeignKey(
        "catalog.Party", null=True, blank=True, on_delete=models.CASCADE,
        related_name="memberships",
        help_text="Solo para usuarios proveedor: la empresa proveedora que representan.",
    )

    class Meta:
        unique_together = [("user", "tenant")]
        verbose_name = "Membresía"
        verbose_name_plural = "Membresías"

    @property
    def is_supplier(self):
        return self.role == self.Role.SUPPLIER

    def __str__(self):
        suffix = f" → {self.party.name}" if self.party_id else ""
        return f"{self.user} @ {self.tenant} ({self.get_role_display()}){suffix}"
