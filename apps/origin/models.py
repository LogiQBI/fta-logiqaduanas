"""Resultados de calificación de origen, certificados emitidos y expediente."""
from django.conf import settings
from django.db import models

from apps.tenants.models import TenantOwnedModel


class Qualification(TenantOwnedModel):
    """Resultado de calificar un producto contra un tratado.
    Se recalcula cuando cambia el BOM, los costos o el origen de un componente."""

    class Status(models.TextChoices):
        QUALIFIES = "QUALIFIES", "Califica"
        DOES_NOT = "DOES_NOT", "No califica"
        INSUFFICIENT = "INSUFFICIENT", "Datos insuficientes"

    product = models.ForeignKey("catalog.Product", on_delete=models.CASCADE,
                                related_name="qualifications")
    treaty = models.ForeignKey("treaties.Treaty", on_delete=models.CASCADE,
                               related_name="qualifications")
    status = models.CharField(max_length=20, choices=Status.choices)
    criterion = models.CharField("Criterio aplicado", max_length=20, blank=True)
    rvc_value = models.DecimalField("VCR calculado (%)", max_digits=6, decimal_places=2,
                                    null=True, blank=True)
    rule = models.ForeignKey("treaties.OriginRule", null=True, blank=True,
                             on_delete=models.SET_NULL)
    detail = models.JSONField("Traza del cálculo", default=dict, blank=True)
    computed_at = models.DateTimeField(auto_now=True)
    computed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                    on_delete=models.SET_NULL)

    class Meta:
        unique_together = [("tenant", "product", "treaty")]
        ordering = ["-computed_at"]
        verbose_name = "Calificación de origen"
        verbose_name_plural = "Calificaciones de origen"

    def __str__(self):
        return f"{self.product.sku} / {self.treaty.code}: {self.get_status_display()}"


class AutomotiveAssessment(TenantOwnedModel):
    """Evaluación del régimen automotriz T-MEC de un producto (vehículo/autoparte):
    RVC por costo neto (phase-in) + LVC + acero/aluminio + core parts. Orientativa."""

    class VehicleClass(models.TextChoices):
        PASSENGER = "passenger", "Automóvil de pasajeros"
        LIGHT_TRUCK = "light_truck", "Camión ligero"
        HEAVY = "heavy", "Vehículo pesado"
        AUTOPART = "autopart", "Autoparte (core)"

    product = models.ForeignKey("catalog.Product", on_delete=models.CASCADE,
                                related_name="automotive_assessments")
    treaty = models.ForeignKey("treaties.Treaty", on_delete=models.CASCADE,
                               related_name="automotive_assessments")
    vehicle_class = models.CharField(max_length=20, choices=VehicleClass.choices,
                                     default=VehicleClass.PASSENGER)
    as_of = models.DateField("Fecha de evaluación (phase-in)", null=True, blank=True)
    net_cost = models.DecimalField("Costo neto", max_digits=16, decimal_places=4, default=0)
    vnm = models.DecimalField("Valor de materiales no originarios", max_digits=16, decimal_places=4, default=0)
    lvc_pct = models.DecimalField("LVC (%)", max_digits=6, decimal_places=2, default=0)
    wage_usd_h = models.DecimalField("Salario base (USD/h)", max_digits=8, decimal_places=2, default=0)
    steel_na_pct = models.DecimalField("Acero N.A. (%)", max_digits=6, decimal_places=2, default=0)
    aluminum_na_pct = models.DecimalField("Aluminio N.A. (%)", max_digits=6, decimal_places=2, default=0)
    core_parts_originating = models.BooleanField("Core parts originarios", default=False)
    qualifies = models.BooleanField("¿Califica (combinado)?", default=False)
    detail = models.JSONField("Traza", default=dict, blank=True)
    computed_at = models.DateTimeField(auto_now=True)
    computed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                    on_delete=models.SET_NULL)

    class Meta:
        unique_together = [("tenant", "product", "treaty")]
        ordering = ["-computed_at"]
        verbose_name = "Evaluación automotriz"
        verbose_name_plural = "Evaluaciones automotrices"

    def __str__(self):
        return f"Automotriz {self.product.sku} / {self.treaty.code}: {'SI' if self.qualifies else 'NO'}"


class Certificate(TenantOwnedModel):
    """Certificado de origen emitido al cliente.
    Guarda los elementos mínimos del T-MEC (Anexo 5-A).
    Regla de negocio: solo se emite si la calificación CALIFICA."""

    class CertifierType(models.TextChoices):
        EXPORTER = "exporter", "Exportador"
        PRODUCER = "producer", "Productor"
        IMPORTER = "importer", "Importador"

    qualification = models.ForeignKey(Qualification, on_delete=models.PROTECT,
                                      related_name="certificates")
    folio = models.CharField("Folio", max_length=40)
    # Token aleatorio para verificación pública (QR). Único globalmente.
    verify_token = models.CharField("Token de verificación", max_length=32, blank=True,
                                    db_index=True)
    certifier_type = models.CharField("Tipo de certificador", max_length=20,
                                      choices=CertifierType.choices)
    # Elementos mínimos (datos de cada parte: nombre, dirección, país, email, tel.)
    certifier_data = models.JSONField("Datos del certificador", default=dict)
    exporter_data = models.JSONField("Datos del exportador", default=dict, blank=True)
    producer_data = models.JSONField("Datos del productor", default=dict, blank=True)
    importer_data = models.JSONField("Datos del importador", default=dict, blank=True)
    blanket_from = models.DateField("Periodo (desde)", null=True, blank=True)
    blanket_to = models.DateField("Periodo (hasta)", null=True, blank=True)
    issued_at = models.DateTimeField("Emitido el", auto_now_add=True)
    issued_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                  on_delete=models.SET_NULL)

    class Meta:
        unique_together = [("tenant", "folio")]
        verbose_name = "Certificado de origen"
        verbose_name_plural = "Certificados de origen"

    def __str__(self):
        return f"Certificado {self.folio} — {self.qualification.product.sku}"


class ExpedienteDocument(TenantOwnedModel):
    """Documento de soporte del expediente. Retención mínima 5 años (T-MEC)."""

    product = models.ForeignKey("catalog.Product", null=True, blank=True,
                                on_delete=models.CASCADE, related_name="documents")
    certificate = models.ForeignKey(Certificate, null=True, blank=True,
                                    on_delete=models.CASCADE, related_name="documents")
    doc_type = models.CharField("Tipo de documento", max_length=50)
    file = models.FileField("Archivo", upload_to="expedientes/%Y/%m/")
    notes = models.TextField("Notas", blank=True)

    class Meta:
        verbose_name = "Documento de expediente"
        verbose_name_plural = "Documentos de expediente"

    def __str__(self):
        return f"{self.doc_type} — {self.file.name}"
