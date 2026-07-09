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
    # LVC reportado como VALOR en USD (high-wage material & manufacturing expenditure):
    # valor de materiales/mano de obra de proveedores con salario ≥ 16 USD/h.
    lvc_value = models.DecimalField("LVC (valor USD)", max_digits=16, decimal_places=4, default=0)
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


class OriginAnalysis(TenantOwnedModel):
    """Histórico de un análisis de origen. A diferencia de Qualification (un solo
    registro vigente por producto×tratado), aquí se GUARDA UN SNAPSHOT por cada vez
    que se corre el cálculo: si cambian precios del producto terminado o de los
    insumos del BOM y se recalcula, queda un nuevo registro con su fecha. Se pueden
    consultar y borrar; no afecta a la calificación vigente."""

    class Kind(models.TextChoices):
        BOM = "bom", "Cálculo por BOM"
        AUTOMOTIVE = "automotive", "Evaluación automotriz"

    product = models.ForeignKey("catalog.Product", on_delete=models.CASCADE,
                                related_name="analyses")
    treaty = models.ForeignKey("treaties.Treaty", on_delete=models.CASCADE,
                               related_name="analyses")
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.BOM)
    status = models.CharField("Resultado", max_length=20, blank=True)
    criterion = models.CharField("Criterio aplicado", max_length=20, blank=True)
    rvc_value = models.DecimalField("VCR (%)", max_digits=6, decimal_places=2,
                                    null=True, blank=True)
    total_value = models.DecimalField("Valor total del BOM", max_digits=16,
                                      decimal_places=4, null=True, blank=True)
    vnm = models.DecimalField("Valor no originario", max_digits=16,
                              decimal_places=4, null=True, blank=True)
    detail = models.JSONField("Traza del cálculo", default=dict, blank=True)
    computed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                    on_delete=models.SET_NULL)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Análisis de origen (histórico)"
        verbose_name_plural = "Análisis de origen (histórico)"

    def __str__(self):
        return f"{self.product.sku} / {self.treaty.code} @ {self.created_at:%Y-%m-%d %H:%M}: {self.status}"


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
    # Anexo 5-A elemento 6(b): número de factura para envío único (opcional).
    invoice_number = models.CharField("Número de factura (envío único)", max_length=60, blank=True)
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


class ClientOriginLayout(TenantOwnedModel):
    """Plantilla del portal de origen del CLIENTE (ej. STELLANTIS), por tratado.

    La empresa sube el .xlsx que le exige su cliente; un MAPEO liga cada columna
    de la plantilla con un campo de FTA (SKU, HS, resultado de origen, criterio…).
    Con eso, FTA genera el archivo lleno —una fila por número de parte— listo para
    subir al portal del cliente. El archivo se guarda en BD (base64; Railway tiene
    almacenamiento efímero)."""

    client = models.ForeignKey("catalog.Party", on_delete=models.CASCADE,
                               related_name="origin_layouts",
                               limit_choices_to={"kind": "customer"})
    treaty = models.ForeignKey("treaties.Treaty", on_delete=models.CASCADE,
                               related_name="client_layouts")
    name = models.CharField("Nombre", max_length=120, blank=True)
    filename = models.CharField("Archivo original", max_length=200, blank=True)
    file_b64 = models.TextField("Plantilla (.xlsx en base64)", blank=True)
    sheet_name = models.CharField("Hoja de datos", max_length=64, blank=True)
    header_row = models.PositiveSmallIntegerField("Fila de encabezados", default=1)
    # {"A": "Part Number", ...} — encabezados detectados al subir la plantilla.
    headers = models.JSONField("Encabezados detectados", default=dict, blank=True)
    # {"A": "sku", "C": "origin_yn", ...} — columna del cliente → campo de FTA.
    mapping = models.JSONField("Mapeo de columnas", default=dict, blank=True)

    class Meta:
        unique_together = [("tenant", "client", "treaty")]
        ordering = ["client__name", "treaty__code"]
        verbose_name = "Layout de portal de cliente"
        verbose_name_plural = "Layouts de portal de cliente"

    def __str__(self):
        return f"{self.client.name} / {self.treaty.code}: {self.name or self.filename}"


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
