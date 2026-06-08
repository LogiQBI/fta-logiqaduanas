"""Servicios de alto nivel: calificar, persistir y emitir certificados."""
from decimal import Decimal
from types import SimpleNamespace

from django.core.exceptions import ValidationError
from django.utils import timezone
from django.utils.dateparse import parse_date

from apps.origin import engine
from apps.origin.models import Certificate, Qualification

# Datos mínimos del certificador (parte del Anexo 5-A del T-MEC).
REQUIRED_PARTY_FIELDS = ["nombre", "direccion", "pais", "email", "telefono"]


def calculate_bom_origin(bom):
    """Calcula el origen del producto terminado a partir del BOM que subió el
    proveedor, aplicando la regla (PSR) de la fracción del producto y tratado.

    Un componente se considera originario si su país está entre los miembros del
    tratado. Soporta CTC (salto arancelario), VCR y combinaciones. Guarda el
    resultado y la traza en el propio BOM y lo devuelve."""
    sr = bom.solicitation
    treaty = sr.treaty
    product = sr.product
    members = treaty.member_countries or []

    rule = bom.rule or engine.find_rule(treaty, product.hs_code or "")
    if rule is None:
        return _save_bom_result(bom, None, {
            "status": "INSUFFICIENT", "criterion": "", "rvc_value": None,
            "detail": {"error": f"No hay regla de origen para HS "
                                f"{product.hs_code} en {treaty.code}."}})

    total = Decimal("0")
    vnm = Decimal("0")
    lines = []
    for l in bom.lines.all():
        val = (l.unit_price or Decimal("0")) * (l.quantity or Decimal("0"))
        originating = bool(l.country and l.country.upper() in members)
        total += val
        if not originating:
            vnm += val
        lines.append({
            "sku": l.part_number, "hs_code": l.hs_code or "",
            "quantity": str(l.quantity), "unit_cost": str(l.unit_price),
            "line_value": str(val), "originating": originating,
            "country": l.country, "has_evidence": l.has_origin_evidence,
        })

    transaction_value = product.unit_cost if product.unit_cost else total
    # Base del VCR según el método elegido por el proveedor.
    method = bom.rvc_method or "transaction"
    if method == "net_cost" and bom.net_cost and Decimal(bom.net_cost) > 0:
        rvc_base = Decimal(bom.net_cost)
    else:
        rvc_base = transaction_value
        if method == "net_cost":
            method = "transaction"  # sin costo neto capturado, se usa transacción
    fake_product = SimpleNamespace(hs_code=product.hs_code or "")
    rt = rule.rule_type
    params = dict(rule.params or {})
    params["rvc_method"] = method  # el método lo decide el proveedor
    shift_level = params.get("shift_level", "CTH")
    de_minimis = params.get("de_minimis", treaty.de_minimis_pct)
    if (params.get("extra") or {}).get("de_minimis_excluded"):
        de_minimis = 0  # la PSR excluye la tolerancia (p.ej. cap. 1-5 agrícolas)
    except_codes = params.get("ctc_except", [])
    detail = {"rule": str(rule), "rule_type": rt, "bom": lines,
              "total_value": str(total)}

    ctc_pass = rvc_pass = None
    rvc_value = None
    if rt in ("CTC", "CTC_OR_RVC", "CTC_AND_RVC"):
        ctc_pass, ctc_detail = engine._check_tariff_shift(
            fake_product, lines, shift_level, de_minimis, total, except_codes=except_codes)
        detail["tariff_shift"] = ctc_detail
    if rt in ("RVC", "CTC_OR_RVC", "CTC_AND_RVC"):
        rvc_pass, rvc_value, rvc_detail = engine._check_rvc(
            treaty, params, rvc_base, vnm)
        detail["rvc"] = rvc_detail

    note = engine.automotive_note(params)
    if note:
        detail["automotive_regime"] = note

    if rt == "WO":
        passed, criterion = (bool(lines) and all(ln["originating"] for ln in lines)), "WO"
    elif rt == "CTC":
        passed, criterion = bool(ctc_pass), "CTC"
    elif rt == "RVC":
        passed, criterion = bool(rvc_pass), "RVC"
    elif rt == "CTC_OR_RVC":
        passed = bool(ctc_pass) or bool(rvc_pass)
        criterion = "CTC" if ctc_pass else ("RVC" if rvc_pass else "CTC_OR_RVC")
    else:  # CTC_AND_RVC
        passed = bool(ctc_pass) and bool(rvc_pass)
        criterion = "CTC_AND_RVC"

    return _save_bom_result(bom, rule, {
        "status": "QUALIFIES" if passed else "DOES_NOT",
        "criterion": criterion, "rvc_value": rvc_value, "detail": detail})


def _save_bom_result(bom, rule, result):
    if rule:
        bom.rule = rule
    bom.origin_status = result["status"]
    bom.criterion = result["criterion"]
    bom.rvc_value = result["rvc_value"]
    bom.detail = result["detail"]
    bom.computed_at = timezone.now()
    bom.save(update_fields=["rule", "origin_status", "criterion", "rvc_value",
                            "detail", "computed_at", "updated_at"])
    return result


def _resolve_component_origin(bc, treaty, default_as_of):
    """Resuelve el origen de UN insumo del BOM de la empresa según su toggle.

    - origin_mode MANUAL: usa lo que capturó la empresa.
    - origin_mode SUPPLIER: usa la declaración del proveedor (la del periodo
      `origin_as_of`, o la del periodo global pedido, o la MÁS RECIENTE). Si no
      hay declaración, cae a país miembro y, en último caso, a no originario.
    """
    from apps.catalog.models import SupplierDeclaration

    comp = bc.component
    value = (comp.unit_cost or Decimal("0")) * (bc.quantity or Decimal("0"))
    members = treaty.member_countries or []

    if bc.origin_mode == "manual":
        country = (bc.manual_country or "").upper()
        if country:
            # El país capturado decide el origen: originario si es país miembro
            # del tratado que se está calculando.
            originating = country in [c.upper() for c in members]
            source = f"País manual: {country}"
        else:
            originating = bool(bc.manual_is_originating)
            source = "Captura manual de la empresa"
        return {"originating": originating, "country": country,
                "value": value, "source": source}

    as_of = bc.origin_as_of or default_as_of
    qs = SupplierDeclaration.objects.filter(product=comp, treaty=treaty)
    if comp.supplier_id:
        qs = qs.filter(supplier_id=comp.supplier_id)
    decl = None
    if as_of:
        decl = qs.filter(valid_from__lte=as_of, valid_to__gte=as_of).order_by("-valid_from").first()
    if decl is None:
        decl = qs.order_by("-valid_from", "-created_at").first()
    if decl:
        return {"originating": decl.is_originating,
                "country": (decl.country_of_origin or "").upper(),
                "value": value,
                "source": f"Declaración del proveedor {decl.valid_from} → {decl.valid_to}"}
    if comp.country_of_origin and comp.country_of_origin.upper() in members:
        return {"originating": True, "country": comp.country_of_origin.upper(),
                "value": value, "source": "País miembro (sin declaración)"}
    return {"originating": False, "country": (comp.country_of_origin or "").upper(),
            "value": value, "source": "Sin declaración de origen"}


def calculate_product_origin(product, treaty, as_of=None, user=None):
    """Calcula el origen del producto terminado de la EMPRESA a partir de SU BOM
    (BOMComponent), resolviendo el origen de cada insumo según su toggle.
    Guarda/actualiza la Qualification y devuelve el resultado con su traza."""
    components = list(product.bom_components.select_related("component").all())
    if not components:
        return _save_qual(product, treaty, None, {
            "status": "INSUFFICIENT", "criterion": "", "rvc_value": None,
            "detail": {"error": "El producto no tiene lista de materiales (BOM)."}}, user)
    rule = engine.find_rule(treaty, product.hs_code or "")
    if rule is None:
        return _save_qual(product, treaty, None, {
            "status": "INSUFFICIENT", "criterion": "", "rvc_value": None,
            "detail": {"error": f"No hay regla de origen para HS "
                                f"{product.hs_code} en {treaty.code}."}}, user)

    total = Decimal("0")
    vnm = Decimal("0")
    lines = []
    for bc in components:
        info = _resolve_component_origin(bc, treaty, as_of)
        val = info["value"]
        total += val
        if not info["originating"]:
            vnm += val
        lines.append({
            "sku": bc.component.sku, "description": bc.component.description,
            "hs_code": bc.component.hs_code or "", "quantity": str(bc.quantity),
            "unit_cost": str(bc.component.unit_cost), "line_value": str(val),
            "originating": info["originating"], "country": info["country"],
            "origin_source": info["source"],
        })

    transaction_value = product.unit_cost if product.unit_cost else total
    rt = rule.rule_type
    params = dict(rule.params or {})
    params.setdefault("rvc_method", "transaction")
    shift_level = params.get("shift_level", "CTH")
    de_minimis = params.get("de_minimis", treaty.de_minimis_pct)
    if (params.get("extra") or {}).get("de_minimis_excluded"):
        de_minimis = 0
    except_codes = params.get("ctc_except", [])
    fake_product = SimpleNamespace(hs_code=product.hs_code or "")
    detail = {"rule": str(rule), "rule_type": rt, "bom": lines, "total_value": str(total)}

    ctc_pass = rvc_pass = None
    rvc_value = None
    if rt in ("CTC", "CTC_OR_RVC", "CTC_AND_RVC"):
        ctc_pass, ctc_detail = engine._check_tariff_shift(
            fake_product, lines, shift_level, de_minimis, total, except_codes=except_codes)
        detail["tariff_shift"] = ctc_detail
    if rt in ("RVC", "CTC_OR_RVC", "CTC_AND_RVC"):
        rvc_pass, rvc_value, rvc_detail = engine._check_rvc(treaty, params, transaction_value, vnm)
        detail["rvc"] = rvc_detail
    note = engine.automotive_note(params)
    if note:
        detail["automotive_regime"] = note

    if rt == "WO":
        passed, criterion = (bool(lines) and all(l["originating"] for l in lines)), "WO"
    elif rt == "CTC":
        passed, criterion = bool(ctc_pass), "CTC"
    elif rt == "RVC":
        passed, criterion = bool(rvc_pass), "RVC"
    elif rt == "CTC_OR_RVC":
        passed = bool(ctc_pass) or bool(rvc_pass)
        criterion = "CTC" if ctc_pass else ("RVC" if rvc_pass else "CTC_OR_RVC")
    else:  # CTC_AND_RVC
        passed = bool(ctc_pass) and bool(rvc_pass)
        criterion = "CTC_AND_RVC"

    return _save_qual(product, treaty, rule, {
        "status": "QUALIFIES" if passed else "DOES_NOT",
        "criterion": criterion, "rvc_value": rvc_value, "detail": detail}, user)


def _save_qual(product, treaty, rule, result, user):
    Qualification.objects.update_or_create(
        tenant=product.tenant, product=product, treaty=treaty,
        defaults={"status": result["status"], "criterion": result["criterion"],
                  "rvc_value": result["rvc_value"], "rule_id": rule.pk if rule else None,
                  "detail": result["detail"], "computed_by": user})
    return result


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
