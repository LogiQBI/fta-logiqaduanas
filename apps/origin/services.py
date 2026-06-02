"""Servicios de alto nivel: calificar, persistir y emitir certificados."""
from django.core.exceptions import ValidationError
from django.utils.dateparse import parse_date

from apps.origin import engine
from apps.origin.models import Certificate, Qualification

# Datos mínimos del certificador (parte del Anexo 5-A del T-MEC).
REQUIRED_PARTY_FIELDS = ["nombre", "direccion", "pais", "email", "telefono"]


def qualify_and_save(product, treaty, user=None, as_of=None):
    """Ejecuta el motor y guarda/actualiza la Qualification del producto×tratado."""
    result = engine.qualify(product, treaty, as_of=as_of)
    rule_id = result["rule_id"]
    qualification, _ = Qualification.objects.update_or_create(
        tenant=product.tenant,
        product=product,
        treaty=treaty,
        defaults={
            "status": result["status"],
            "criterion": result["criterion"],
            "rvc_value": result["rvc_value"],
            "rule_id": rule_id,
            "detail": result["detail"],
            "computed_by": user,
        },
    )
    return qualification


def _next_folio(tenant):
    """Folio simple e incremental por tenant: FTA-<tenant>-<n>."""
    n = Certificate.objects.filter(tenant=tenant).count() + 1
    return f"FTA-{tenant.id}-{n:05d}"


def issue_certificate(qualification, *, certifier_type, certifier_data,
                      exporter_data=None, producer_data=None, importer_data=None,
                      blanket_from=None, blanket_to=None, folio=None, user=None):
    """Emite un certificado de origen para una calificación.

    Reglas de negocio (T-MEC):
      - Solo se emite si la calificación CALIFICA.
      - Deben estar los datos mínimos del certificador.
      - La calificación debe tener un criterio de origen.
      - El periodo (blanket) no puede exceder 12 meses.
    Lanza ValidationError si algo falla.
    """
    if qualification.status != Qualification.Status.QUALIFIES:
        raise ValidationError(
            "No se puede emitir certificado: el producto NO califica para este tratado."
        )
    if not qualification.criterion:
        raise ValidationError("La calificación no tiene criterio de origen.")

    certifier_data = certifier_data or {}
    missing = [f for f in REQUIRED_PARTY_FIELDS if not certifier_data.get(f)]
    if missing:
        raise ValidationError(f"Faltan datos del certificador: {', '.join(missing)}.")

    # Las fechas pueden llegar como texto ISO desde la API.
    if isinstance(blanket_from, str):
        blanket_from = parse_date(blanket_from)
    if isinstance(blanket_to, str):
        blanket_to = parse_date(blanket_to)

    if blanket_from and blanket_to:
        if blanket_to < blanket_from:
            raise ValidationError("El periodo del certificado es inválido (fin antes que inicio).")
        if (blanket_to - blanket_from).days > 366:
            raise ValidationError("El periodo del certificado no puede exceder 12 meses.")

    return Certificate.objects.create(
        tenant=qualification.tenant,
        qualification=qualification,
        folio=folio or _next_folio(qualification.tenant),
        certifier_type=certifier_type,
        certifier_data=certifier_data,
        exporter_data=exporter_data or {},
        producer_data=producer_data or {},
        importer_data=importer_data or {},
        blanket_from=blanket_from,
        blanket_to=blanket_to,
        issued_by=user,
    )


def certificate_elements(certificate):
    """Devuelve los 9 elementos mínimos del T-MEC (Anexo 5-A) listos para imprimir."""
    q = certificate.qualification
    prod = q.product
    return {
        "1_tipo_certificador": certificate.get_certifier_type_display(),
        "2_certificador": certificate.certifier_data,
        "3_exportador": certificate.exporter_data,
        "4_productor": certificate.producer_data,
        "5_importador": certificate.importer_data,
        "6_descripcion_y_hs": {
            "descripcion": prod.description,
            "hs_6": (prod.hs_code or "")[:6],
        },
        "7_criterio_de_origen": q.criterion,
        "8_periodo": {"desde": certificate.blanket_from, "hasta": certificate.blanket_to},
        "9_firma_y_fecha": {
            "folio": certificate.folio,
            "emitido_por": certificate.issued_by.get_username() if certificate.issued_by else None,
            "fecha": certificate.issued_at,
        },
    }
