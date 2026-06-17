"""Servicios de alto nivel: calificar, persistir y emitir certificados."""
import logging
from decimal import Decimal
from types import SimpleNamespace

from django.core.exceptions import ValidationError
from django.utils import timezone
from django.utils.dateparse import parse_date

from apps.origin import engine
from apps.origin.models import Certificate, OriginAnalysis, Qualification

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

    note = engine.automotive_note(params, product.hs_code or "")
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

    result = engine.apply_core_part_review(product.hs_code or "", {
        "status": "QUALIFIES" if passed else "DOES_NOT",
        "criterion": criterion, "rvc_value": rvc_value, "detail": detail})
    return _save_bom_result(bom, rule, result)


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


def _resolve_component_origin(bc, treaty, default_as_of, visited):
    """Resuelve el origen de UN insumo del BOM, según su toggle:

    - MANUAL: usa el país capturado (originario si es país miembro).
    - DECLARACIÓN: usa la declaración del proveedor (periodo o más reciente).
    - Si NO hay declaración y el insumo es un SUBENSAMBLE con su propio BOM
      (fabricado en casa), se calcula su origen RECURSIVAMENTE y, si califica,
      su valor TOTAL cuenta como originario (roll-up).
    - Si no, cae a país miembro y, en último caso, a no originario.
    """
    from apps.catalog.models import SupplierDeclaration

    comp = bc.component
    value = (comp.unit_cost or Decimal("0")) * (bc.quantity or Decimal("0"))
    members = [c.upper() for c in (treaty.member_countries or [])]

    if bc.origin_mode == "manual":
        country = (bc.manual_country or "").upper()
        if country:
            return {"originating": country in members, "country": country,
                    "value": value, "source": f"País manual: {country}"}
        return {"originating": bool(bc.manual_is_originating), "country": "",
                "value": value, "source": "Captura manual de la empresa"}

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
                "country": (decl.country_of_origin or "").upper(), "value": value,
                "source": f"Declaración del proveedor {decl.valid_from} → {decl.valid_to}"}

    # Subensamble fabricado en casa: calificarlo con SU propio BOM (roll-up).
    if comp.id not in visited and comp.bom_components.exists():
        sub = _evaluate_product(comp, treaty, as_of, visited)
        orig = sub["status"] == "QUALIFIES"
        rvc = sub.get("rvc_value")
        return {"originating": orig, "country": (comp.country_of_origin or "").upper(),
                "value": value,
                "source": ("Subensamble calculado (roll-up): "
                           + ("originario" if orig else "no originario")
                           + (f" · VCR {rvc}%" if rvc is not None else ""))}

    if comp.country_of_origin and comp.country_of_origin.upper() in members:
        return {"originating": True, "country": comp.country_of_origin.upper(),
                "value": value, "source": "País miembro (sin declaración)"}
    return {"originating": False, "country": (comp.country_of_origin or "").upper(),
            "value": value, "source": "Sin declaración ni BOM propio"}


def bom_lines_for(product, treaty, as_of=None):
    """Devuelve (lines, total_materiales, vnm) del BOM de `product` para `treaty`,
    con el mismo formato de línea del motor (para snapshots/reportes, p.ej. el
    cálculo automotriz que necesita guardar el desglose del BOM)."""
    total = Decimal("0")
    vnm = Decimal("0")
    lines = []
    comps = product.bom_components.select_related("component", "component__supplier").all()
    for bc in comps:
        info = _resolve_component_origin(bc, treaty, as_of, set())
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
            "supplier": (bc.component.supplier.name if bc.component.supplier_id else ""),
        })
    return lines, total, vnm


def _evaluate_product(product, treaty, as_of, visited):
    """Evalúa el origen de un producto a partir de su BOM, RECURSIVAMENTE: los
    subensambles con BOM propio se califican primero y, si originan, hacen
    roll-up (su valor total cuenta como originario). Detecta ciclos."""
    if product.id in visited:
        return {"status": "INSUFFICIENT", "criterion": "", "rvc_value": None, "rule": None,
                "detail": {"error": f"Ciclo en el BOM detectado en {product.sku}."}}
    visited = visited | {product.id}
    components = list(product.bom_components.select_related("component", "component__supplier").all())
    if not components:
        return {"status": "INSUFFICIENT", "criterion": "", "rvc_value": None, "rule": None,
                "detail": {"error": "El producto no tiene lista de materiales (BOM)."}}
    rule = engine.find_rule(treaty, product.hs_code or "")
    if rule is None:
        return {"status": "INSUFFICIENT", "criterion": "", "rvc_value": None, "rule": None,
                "detail": {"error": f"No hay regla de origen para HS "
                                    f"{product.hs_code} en {treaty.code}."}}

    total = Decimal("0")
    vnm = Decimal("0")
    lines = []
    for bc in components:
        info = _resolve_component_origin(bc, treaty, as_of, visited)
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
            "supplier": (bc.component.supplier.name if bc.component.supplier_id else ""),
        })

    # Costo neto del bien = materiales (BOM) + mano de obra/costos de conversión.
    # La conversión es valor agregado REGIONAL (originario): suma a la base del VCR
    # pero NO al VNM. Es la base del cálculo de Valor de Contenido Regional.
    conversion = Decimal(str(product.conversion_cost or 0))
    net_cost = total + conversion
    rt = rule.rule_type
    params = dict(rule.params or {})
    params.setdefault("rvc_method", "transaction")
    shift_level = params.get("shift_level", "CTH")
    de_minimis = params.get("de_minimis", treaty.de_minimis_pct)
    if (params.get("extra") or {}).get("de_minimis_excluded"):
        de_minimis = 0
    except_codes = params.get("ctc_except", [])
    fake_product = SimpleNamespace(hs_code=product.hs_code or "")
    detail = {"rule": str(rule), "rule_type": rt, "bom": lines,
              "materials_total": str(total), "conversion_cost": str(conversion),
              "total_value": str(net_cost), "vnm": str(vnm),
              "psr": {"hs_pattern": rule.hs_pattern, "rule_type": rt,
                      "description": rule.description}}

    ctc_pass = rvc_pass = None
    rvc_value = None
    if rt in ("CTC", "CTC_OR_RVC", "CTC_AND_RVC"):
        ctc_pass, ctc_detail = engine._check_tariff_shift(
            fake_product, lines, shift_level, de_minimis, total, except_codes=except_codes)
        detail["tariff_shift"] = ctc_detail
    if rt in ("RVC", "CTC_OR_RVC", "CTC_AND_RVC"):
        rvc_pass, rvc_value, rvc_detail = engine._check_rvc(treaty, params, net_cost, vnm)
        detail["rvc"] = rvc_detail
    note = engine.automotive_note(params, product.hs_code or "")
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

    result = {"status": "QUALIFIES" if passed else "DOES_NOT", "criterion": criterion,
              "rvc_value": rvc_value, "detail": detail, "rule": rule}
    # Core part (Anexo 4-B): el salto/VCR del BOM no concluye; requiere automotriz.
    return engine.apply_core_part_review(product.hs_code or "", result)


def calculate_product_origin(product, treaty, as_of=None, user=None):
    """Calcula el origen del producto de la EMPRESA a partir de SU BOM, con
    roll-up recursivo de subensambles. Guarda la Qualification y devuelve la traza."""
    result = _evaluate_product(product, treaty, as_of, set())
    rule = result.get("rule")
    _save_qual(product, treaty, rule, result, user)
    # Snapshot en el histórico: cada corrida queda guardada con su fecha, para poder
    # comparar resultados cuando cambian precios del producto o de los insumos del BOM.
    # Auxiliar: un fallo aquí no debe tumbar el cálculo.
    try:
        save_analysis_snapshot(product, treaty, OriginAnalysis.Kind.BOM, result, user)
    except Exception:
        logging.getLogger(__name__).exception(
            "No se pudo guardar el snapshot del análisis BOM (product=%s, treaty=%s)",
            product.pk, treaty.pk)
    # El resultado se devuelve por la API: no debe contener el objeto OriginRule
    # (no es JSON-serializable). La descripción de la regla ya va en detail["rule"].
    result.pop("rule", None)
    result["rule_id"] = rule.pk if rule else None
    return result


def save_analysis_snapshot(product, treaty, kind, result, user):
    """Guarda un registro del histórico de análisis de origen (no toca la
    Qualification vigente). `result` es la traza del motor (BOM o automotriz)."""
    detail = result.get("detail") or {}

    def _dec(v):
        try:
            return Decimal(str(v))
        except Exception:
            return None
    return OriginAnalysis.objects.create(
        tenant=product.tenant, product=product, treaty=treaty, kind=kind,
        status=result.get("status") or "", criterion=result.get("criterion") or "",
        rvc_value=_dec(result.get("rvc_value")) if result.get("rvc_value") is not None else None,
        total_value=_dec(detail.get("total_value")),
        vnm=_dec(detail.get("vnm")),
        detail=detail, computed_by=user)


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


# --- Certificado de origen del PROVEEDOR por solicitud (firmado) ---

_TREATY_LABELS = {"TMEC": "USMCA"}


def _cert_party_block(prof, fallback_name="", fallback_country=""):
    """Bloque de datos de una parte (productor/importador) desde su perfil."""
    if not prof:
        return {"nombre": fallback_name, "rfc": "", "direccion": "", "pais": fallback_country,
                "email": "", "telefono": "", "firmante": "", "cargo": ""}
    direccion = ", ".join(p for p in [prof.address, prof.city, prof.state, prof.postal_code] if p)
    return {"nombre": prof.legal_name or fallback_name, "rfc": prof.tax_id,
            "direccion": direccion, "pais": prof.country or fallback_country,
            "email": prof.contact_email, "telefono": prof.contact_phone,
            "firmante": prof.signatory_name, "cargo": prof.signatory_title}


def build_solicitation_cert_data(sr):
    """Snapshot de los datos del certificado a partir de la solicitud aceptada.
    El origen viene de la declaración manual o, si es por BOM, del cálculo del BOM."""
    from apps.catalog.models import SolicitationBOM
    supplier = sr.supplier
    sup_prof = getattr(supplier, "profile", None)
    comp_prof = getattr(sr.tenant, "profile", None)

    origin = {"is_originating": None, "country": "", "criterion": "", "rule": ""}
    decl = sr.declaration
    if decl:
        origin = {
            "is_originating": decl.is_originating,
            "country": decl.country_of_origin or "",
            "criterion": (decl.rule.rule_type if decl.rule_id else ""),
            "rule": (decl.rule.description if decl.rule_id else ""),
        }
    else:
        bom = SolicitationBOM.objects.filter(solicitation=sr).select_related("rule").first()
        if bom:
            origin = {
                "is_originating": bom.origin_status == "QUALIFIES",
                "country": "",
                "criterion": bom.criterion or bom.origin_status or "",
                "rule": (bom.rule.description if bom.rule_id else ""),
            }

    return {
        "producer": _cert_party_block(sup_prof, supplier.name, supplier.country),
        "importer": _cert_party_block(comp_prof, sr.tenant.name),
        "product": {"sku": sr.product.sku, "description": sr.product.description,
                    "hs": sr.product.hs_code or ""},
        "treaty": {"code": sr.treaty.code, "label": _TREATY_LABELS.get(sr.treaty.code, sr.treaty.code)},
        "origin": origin,
        "period": {"from": sr.period_from.isoformat() if sr.period_from else None,
                   "to": sr.period_to.isoformat() if sr.period_to else None},
    }


def _next_cert_folio(tenant):
    from apps.origin.models import SolicitationCertificate
    n = SolicitationCertificate.objects.filter(tenant=tenant).count() + 1
    return f"FTA-DO-{tenant.id}-{n:05d}"


def ensure_solicitation_certificate(sr, user, sign_method):
    """Crea (o actualiza, si aún no se firma) el certificado de la solicitud con el
    método de firma EXIGIDO por la empresa. Idempotente."""
    import secrets
    from apps.origin.models import SolicitationCertificate
    cert, created = SolicitationCertificate.objects.get_or_create(
        solicitation=sr,
        defaults={"tenant": sr.tenant, "folio": _next_cert_folio(sr.tenant),
                  "verify_token": secrets.token_urlsafe(16)[:32],
                  "data": build_solicitation_cert_data(sr),
                  "sign_method": sign_method, "requested_by": user})
    if not created and not cert.signed:
        cert.sign_method = sign_method
        cert.requested_by = user
        cert.data = build_solicitation_cert_data(sr)
        cert.save(update_fields=["sign_method", "requested_by", "data", "updated_at"])
    return cert
