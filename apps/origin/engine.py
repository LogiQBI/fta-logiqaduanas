"""Motor de calificación de origen (data-driven).

Aplica las reglas de origen del tratado (almacenadas como datos en
apps.treaties.OriginRule) sobre el BOM multinivel de un producto y determina
si CALIFICA, NO CALIFICA o faltan datos.

Criterios soportados en el MVP:
  - WO           Totalmente obtenido
  - CTC          Salto arancelario (niveles CC / CTH / CTSH) con de minimis
  - RVC          Valor de contenido regional (valor de transacción y costo neto)
  - CTC_OR_RVC   Cualquiera de los dos
  - CTC_AND_RVC  Ambos

El resultado es un dict con la traza completa del cálculo (para el expediente).
"""
from decimal import Decimal

# Cuántos dígitos del HS compara cada nivel de salto arancelario.
SHIFT_DIGITS = {"CC": 2, "CTH": 4, "CTSH": 6}


def _date_ok(rule, as_of):
    if as_of is None:
        return True
    if rule.valid_from and as_of < rule.valid_from:
        return False
    if rule.valid_to and as_of > rule.valid_to:
        return False
    return True


def find_rule(treaty, hs_code, as_of=None):
    """Elige la regla cuyo patrón HS coincide y es el MÁS específico (más largo)."""
    candidates = [
        r for r in treaty.rules.all()
        if hs_code.startswith(r.hs_pattern) and _date_ok(r, as_of)
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda r: len(r.hs_pattern))


def is_originating(product, treaty, as_of=None, _visited=None):
    """¿El componente es originario para el tratado? (con recursión de BOM)."""
    _visited = _visited or set()
    if product.pk in _visited:
        return False  # evita ciclos
    _visited.add(product.pk)

    # 1) Declaración de proveedor vigente que lo marca originario.
    decl_qs = product.declarations.filter(treaty=treaty, is_originating=True)
    if as_of is not None:
        decl_qs = decl_qs.filter(valid_from__lte=as_of, valid_to__gte=as_of)
    if decl_qs.exists():
        return True

    # 2) País de origen propio dentro de los países miembro del tratado.
    members = treaty.member_countries or []
    if product.country_of_origin and product.country_of_origin in members:
        return True

    # 3) Si tiene BOM propio, calificarlo recursivamente.
    if product.bom_components.exists():
        sub = qualify(product, treaty, as_of, _visited)
        return sub["status"] == "QUALIFIES"

    return False


def _bom_values(product, treaty, as_of, _visited):
    """Calcula valor total y desglosa materiales originarios / no originarios."""
    components = list(product.bom_components.select_related("component").all())
    total = Decimal("0")
    vnm = Decimal("0")  # value of non-originating materials
    lines = []
    for bom in components:
        comp = bom.component
        line_value = (comp.unit_cost or Decimal("0")) * bom.quantity
        total += line_value
        originating = is_originating(comp, treaty, as_of, set(_visited))
        if not originating:
            vnm += line_value
        lines.append({
            "sku": comp.sku,
            "hs_code": comp.hs_code,
            "quantity": str(bom.quantity),
            "unit_cost": str(comp.unit_cost),
            "line_value": str(line_value),
            "originating": originating,
        })
    # Valor de transacción del bien: su costo si está capturado, si no la suma del BOM.
    transaction_value = product.unit_cost if product.unit_cost else total
    return transaction_value, total, vnm, lines


def _check_tariff_shift(product, lines, shift_level, de_minimis, total_value):
    """Cada material NO originario debe cambiar de clasificación al nivel pedido."""
    n = SHIFT_DIGITS.get(shift_level, 4)
    prod_prefix = (product.hs_code or "")[:n]
    violating = Decimal("0")
    detail = []
    for ln in lines:
        if ln["originating"]:
            continue
        shifted = ln["hs_code"][:n] != prod_prefix
        if not shifted:
            violating += Decimal(ln["line_value"])
        detail.append({"sku": ln["sku"], "shifted": shifted})
    # De minimis: tolera un % de materiales que no cumplen el salto.
    dm = Decimal(str(de_minimis or 0))
    violating_pct = (violating / total_value * 100) if total_value else Decimal("0")
    passed = violating == 0 or violating_pct <= dm
    return passed, {
        "shift_level": shift_level,
        "violating_value": str(violating),
        "violating_pct": str(round(violating_pct, 2)),
        "de_minimis": str(dm),
        "components": detail,
    }


def _check_rvc(treaty, params, transaction_value, vnm):
    """Valor de Contenido Regional. RVC = (Valor - VNM) / Valor * 100."""
    method = params.get("rvc_method", "transaction")
    if method == "net_cost":
        threshold = Decimal(str(params.get("rvc_threshold", treaty.rvc_net_cost_threshold)))
    else:
        threshold = Decimal(str(params.get("rvc_threshold", treaty.rvc_transaction_threshold)))
    if not transaction_value:
        return False, None, {"method": method, "error": "sin valor de transacción"}
    rvc = (Decimal(transaction_value) - vnm) / Decimal(transaction_value) * 100
    rvc = round(rvc, 2)
    passed = rvc >= threshold
    return passed, rvc, {
        "method": method,
        "threshold": str(threshold),
        "rvc": str(rvc),
        "vnm": str(vnm),
        "transaction_value": str(transaction_value),
    }


def qualify(product, treaty, as_of=None, _visited=None):
    """Califica `product` contra `treaty`. Devuelve dict con status y traza."""
    _visited = _visited or set()
    rule = find_rule(treaty, product.hs_code or "", as_of)
    if rule is None:
        return {
            "status": "INSUFFICIENT", "criterion": "", "rvc_value": None,
            "rule_id": None, "detail": {"error": f"No hay regla de origen para HS {product.hs_code} en {treaty.code}"},
        }

    transaction_value, total, vnm, lines = _bom_values(product, treaty, as_of, _visited)
    detail = {"rule": str(rule), "bom": lines}

    rt = rule.rule_type
    params = rule.params or {}

    # --- Totalmente obtenido ---
    if rt == "WO":
        all_orig = all(ln["originating"] for ln in lines) and bool(lines)
        own = (product.country_of_origin or "") in (treaty.member_countries or [])
        passed = all_orig or (own and not lines)
        detail["wholly_obtained"] = {"all_components_originating": all_orig, "own_country_member": own}
        return _result(passed, "WO", None, rule, detail)

    if not lines:
        detail["error"] = "El producto no tiene BOM para evaluar salto arancelario / VCR"
        return _result(False, rt, None, rule, detail, insufficient=True)

    shift_level = params.get("shift_level", "CTH")
    de_minimis = params.get("de_minimis", treaty.de_minimis_pct)

    ctc_pass = rvc_pass = None
    rvc_value = None

    if rt in ("CTC", "CTC_OR_RVC", "CTC_AND_RVC"):
        ctc_pass, ctc_detail = _check_tariff_shift(product, lines, shift_level, de_minimis, total)
        detail["tariff_shift"] = ctc_detail
    if rt in ("RVC", "CTC_OR_RVC", "CTC_AND_RVC"):
        rvc_pass, rvc_value, rvc_detail = _check_rvc(treaty, params, transaction_value, vnm)
        detail["rvc"] = rvc_detail

    if rt == "CTC":
        passed, criterion = ctc_pass, "CTC"
    elif rt == "RVC":
        passed, criterion = rvc_pass, "RVC"
    elif rt == "CTC_OR_RVC":
        passed = bool(ctc_pass) or bool(rvc_pass)
        criterion = "CTC" if ctc_pass else ("RVC" if rvc_pass else "CTC_OR_RVC")
    else:  # CTC_AND_RVC
        passed = bool(ctc_pass) and bool(rvc_pass)
        criterion = "CTC_AND_RVC"

    return _result(passed, criterion, rvc_value, rule, detail)


def _result(passed, criterion, rvc_value, rule, detail, insufficient=False):
    if insufficient:
        status = "INSUFFICIENT"
    else:
        status = "QUALIFIES" if passed else "DOES_NOT"
    return {
        "status": status,
        "criterion": criterion,
        "rvc_value": rvc_value,
        "rule_id": rule.pk if rule else None,
        "detail": detail,
    }
