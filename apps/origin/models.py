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
        AUTO_REVIEW = "AUTO_REVIEW", "Requiere régimen automotriz"

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


class SolicitationCertificate(TenantOwnedModel):
    """Certificado de origen que el PROVEEDOR firma para la EMPRESA, ligado a una
    solicitud aceptada. La empresa elige AL ACEPTAR cómo debe firmar el proveedor
    (`sign_method`); el proveedor solo cumple ese método. Visible para ambos
    tenants (la empresa por tenant, el proveedor por su Party)."""

    class Method(models.TextChoices):
        PNG = "png", "Firma digital (PNG)"
        MANUAL = "manual", "Firma manual (escaneada)"
        QR = "qr", "Firma por QR"
        PNG_QR = "png_qr", "Firma digital + QR"
        MANUAL_QR = "manual_qr", "Firma manual + QR"

    solicitation = models.OneToOneField("catalog.SolicitationRequest",
                                        on_delete=models.CASCADE, related_name="certificate")
    folio = models.CharField("Folio", max_length=40)
    verify_token = models.CharField("Token de verificación", max_length=32, blank=True,
                                    db_index=True)
    # Snapshot de los datos del certificado al momento de aceptar (estable).
    data = models.JSONField("Datos del certificado", default=dict, blank=True)
    sign_method = models.CharField("Método de firma exigido", max_length=12,
                                   choices=Method.choices, default=Method.PNG)
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                     on_delete=models.SET_NULL, related_name="+")
    # Artefactos de firma (base64 en BD; Railway tiene almacenamiento efímero).
    signature_png = models.TextField("Firma (PNG base64)", blank=True)
    scanned_file = models.TextField("Escaneado firmado (data URI)", blank=True)
    signed = models.BooleanField("Firmado", default=False)
    signed_at = models.DateTimeField("Firmado el", null=True, blank=True)
    signed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                  on_delete=models.SET_NULL, related_name="+")

    class Meta:
        unique_together = [("tenant", "folio")]
        ordering = ["-created_at"]
        verbose_name = "Certificado de solicitud"
        verbose_name_plural = "Certificados de solicitud"

    @property
    def needs_png(self):
        return self.sign_method in (self.Method.PNG, self.Method.PNG_QR)

    @property
    def needs_scan(self):
        return self.sign_method in (self.Method.MANUAL, self.Method.MANUAL_QR)

    @property
    def needs_qr(self):
        return self.sign_method in (self.Method.QR, self.Method.PNG_QR, self.Method.MANUAL_QR)

    def __str__(self):
        return f"Certificado {self.folio} (solicitud {self.solicitation_id})"


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
