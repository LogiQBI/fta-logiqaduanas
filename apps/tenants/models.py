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
        ordering = ["name"]
        verbose_name = "Empresa (tenant)"
        verbose_name_plural = "Empresas (tenants)"

    def __str__(self):
        return self.name


class License(TimeStampedModel):
    """Licencia del SaaS por empresa. La gestiona el equipo master de LogiQ."""

    class Plan(models.TextChoices):
        TRIAL = "trial", "Prueba"
        BASIC = "basic", "Básico"
        PRO = "pro", "Pro"
        ENTERPRISE = "enterprise", "Enterprise"

    class Status(models.TextChoices):
        ACTIVE = "active", "Activa"
        SUSPENDED = "suspended", "Suspendida"
        EXPIRED = "expired", "Vencida"

    tenant = models.OneToOneField(Tenant, on_delete=models.CASCADE, related_name="license")
    plan = models.CharField(max_length=20, choices=Plan.choices, default=Plan.TRIAL)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    valid_until = models.DateField("Vigente hasta", null=True, blank=True)
    max_users = models.PositiveIntegerField("Máx. usuarios", default=5)
    max_products = models.PositiveIntegerField("Máx. productos", default=100)

    class Meta:
        verbose_name = "Licencia"
        verbose_name_plural = "Licencias"

    @property
    def is_valid(self):
        """¿La licencia permite el acceso ahora?"""
        from django.utils import timezone
        if self.status != self.Status.ACTIVE:
            return False
        if self.valid_until and self.valid_until < timezone.localdate():
            return False
        return True

    def __str__(self):
        return f"{self.tenant.name} · {self.get_plan_display()} ({self.get_status_display()})"


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
    must_change_password = models.BooleanField(
        "Debe cambiar contraseña", default=False,
        help_text="Activo cuando tiene una contraseña temporal; se apaga al cambiarla.")
    # Nombre que el proveedor ESCRIBE al entrar (único dentro de su proveedor,
    # no global). El User.username interno se namespacea para evitar choques
    # cuando dos empresas tienen el mismo proveedor.
    login_name = models.CharField("Usuario de acceso", max_length=150, blank=True)

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
