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


def _only_digits(s):
    return "".join(c for c in (s or "") if c.isdigit())


def find_rule(treaty, hs_code, as_of=None):
    """Elige la regla aplicable MÁS ESPECÍFICA para una fracción.

    Soporta dos formas de cobertura:
      - Por RANGO (hs_from/hs_to a hs_level dígitos): aplica si el código del bien,
        truncado a hs_level, cae dentro de [hs_from, hs_to].
      - Por PREFIJO (hs_pattern): aplica si el código empieza con el patrón
        (patrón vacío = regla general/residual).
    La especificidad es el número de dígitos que casan (mayor = más específico)."""
    d = _only_digits(hs_code)
    best = None
    best_spec = -1
    for r in treaty.rules.all():
        if not _date_ok(r, as_of):
            continue
        if r.hs_from and r.hs_level:
            L = r.hs_level
            if len(d) < L:
                continue
            lo = _only_digits(r.hs_from)[:L].zfill(L)
            hi = _only_digits(r.hs_to or r.hs_from)[:L].zfill(L)
            if lo <= d[:L] <= hi:
                spec = L
            else:
                continue
        else:
            pat = _only_digits(r.hs_pattern)
            if not d.startswith(pat):
                continue
            spec = len(pat)
        if spec > best_spec:
            best_spec = spec
            best = r
    return best


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


def _digits(code):
    return "".join(ch for ch in (code or "") if ch.isdigit())


# Fracciones (4 dígitos) del sector automotor para el aviso de régimen.
AUTO_VEHICLE_HEADINGS = {"8701", "8702", "8703", "8704", "8705"}
AUTO_PART_HEADINGS = {"8706", "8707", "8708"}


def automotive_note(params, hs_code=""):
    """Aviso de régimen automotriz para el expediente. Se dispara si la PSR trae
    banderas en 'extra' (LVC / acero-aluminio / core) O si la fracción del bien
    es del sector automotor (cap. 87 vehículos/autopartes), SIEMPRE (califique o
    no), porque el VCR no basta: hay requisitos que el motor no calcula.
    Devuelve None si no aplica."""
    extra = (params or {}).get("extra") or {}
    flags = []
    if extra.get("lvc_pct"):
        flags.append(
            f"Valor de Contenido Laboral (LVC) ≥ {extra['lvc_pct']}% a "
            f"≥ {extra.get('lvc_wage_usd_h', 16)} USD/hora")
    if extra.get("steel_aluminum_originating_pct"):
        flags.append(
            f"compra de acero/aluminio originario ≥ {extra['steel_aluminum_originating_pct']}%")
    if extra.get("is_core_part") or extra.get("core_parts_required") or extra.get("core_part_75_if_listed"):
        flags.append("verificar si es 'core part' (puede exigir VCR 75% costo neto)")
    if flags:
        return ("Régimen automotriz T-MEC: además del VCR, este bien está sujeto a "
                + "; ".join(flags) + ". Estos requisitos NO los calcula el motor; "
                "deben validarse por separado con un especialista.")
    # Aviso por fracción automotriz aunque la regla no traiga banderas.
    h = "".join(c for c in (hs_code or "") if c.isdigit())[:4]
    if h in AUTO_VEHICLE_HEADINGS:
        return ("Sector automotor (vehículo, fracción " + h + "). En el USMCA, además del VCR, "
                "aplican el Valor de Contenido Laboral (LVC), la compra de acero/aluminio "
                "originario y reglas de 'core/super-core parts'. Estos requisitos NO los calcula "
                "el motor; valídalos por separado con un especialista.")
    if h in AUTO_PART_HEADINGS:
        return ("Sector automotor (autoparte, fracción " + h + "). En el USMCA puede aplicar el "
                "régimen automotriz (VCR mayor para 'core parts' y requisitos de acero/aluminio). "
                "Verifica si es parte esencial; estos requisitos NO los calcula el motor.")
    return None


# --- Partes esenciales ("core parts") del régimen automotriz T-MEC ---
# Anexo 4-B (Apéndice), Tabla A.1: partes para las que el SALTO ARANCELARIO NO
# basta; requieren el régimen automotriz (VCR alto por costo neto + Valor de
# Contenido Laboral + compra de acero/aluminio originario / super-core).
# Lista ORIENTATIVA por partida (4 díg.) / subpartida (6 díg.) del SA. Ajustable.
CORE_PART_CODES = {
    "840731", "840732", "840733", "840734",  # Motores de chispa (vehículos)
    "840820",                                  # Motores diésel (vehículos)
    "840991", "840999",                        # Partes de motores
    "870840",                                  # Cajas de cambio / transmisiones
    "8707",                                    # Carrocerías y chasis
    "870850",                                  # Ejes con diferencial
    "870880",                                  # Sistemas de suspensión (amortiguadores)
    "870894",                                  # Volantes, columnas y cajas de dirección
    "850760",                                  # Baterías avanzadas (ion-litio)
}

CORE_PART_NOTE = (
    "PARTE ESENCIAL (core part) del régimen automotriz T-MEC (Anexo 4-B, Apéndice, "
    "Tabla A.1). Para estas partes el salto arancelario NO es suficiente: deben cumplir "
    "Valor de Contenido Regional alto por costo neto, Valor de Contenido Laboral (LVC) y "
    "los requisitos de acero/aluminio originario (super-core). El cálculo por BOM es solo "
    "informativo; usa el módulo «Automotriz (T-MEC)» para la determinación de origen."
)


def core_part_code(hs_code):
    """Devuelve el código de 'core part' (Anexo 4-B) que coincide con la fracción
    por prefijo (subpartida o partida), o None si no es parte esencial."""
    d = _digits(hs_code)
    if not d:
        return None
    for code in sorted(CORE_PART_CODES, key=len, reverse=True):
        if d.startswith(code):
            return code
    return None


def apply_core_part_review(hs_code, result):
    """Si la fracción del bien es una 'core part', el motor de BOM NO concluye el
    origen: se marca el resultado como 'AUTO_REVIEW' (requiere régimen automotriz)
    y se anexa la nota. Conserva la traza CTC/VCR calculada como referencia."""
    code = core_part_code(hs_code)
    if not code:
        return result
    detail = result.setdefault("detail", {})
    detail["automotive_core"] = CORE_PART_NOTE
    detail["automotive_core_code"] = code
    # El aviso de core part es más específico: reemplaza al aviso genérico de cap. 87.
    detail.pop("automotive_regime", None)
    result["status"] = "AUTO_REVIEW"
    return result


def _check_tariff_shift(product, lines, shift_level, de_minimis, total_value,
                        except_codes=()):
    """Cada material NO originario debe cambiar de clasificación al nivel pedido.

    `except_codes`: códigos SA desde los cuales NO se permite el cambio (cláusula
    "excepto de la partida X"). Un material no originario cuya fracción caiga en
    una excepción hace FALLAR el salto aunque haya cambiado de clasificación.
    """
    n = SHIFT_DIGITS.get(shift_level, 4)
    prod_prefix = _digits(product.hs_code)[:n]
    excepts = [_digits(c) for c in (except_codes or []) if _digits(c)]
    violating = Decimal("0")
    detail = []
    for ln in lines:
        if ln["originating"]:
            continue
        mat = _digits(ln["hs_code"])
        shifted = mat[:n] != prod_prefix
        # ¿La fracción del material está vetada por una excepción?
        in_exception = any(mat.startswith(exc) for exc in excepts)
        ok = shifted and not in_exception
        if not ok:
            violating += Decimal(ln["line_value"])
        detail.append({"sku": ln["sku"], "shifted": shifted,
                       "in_exception": in_exception})
    # De minimis: tolera un % de materiales que no cumplen el salto.
    dm = Decimal(str(de_minimis or 0))
    violating_pct = (violating / total_value * 100) if total_value else Decimal("0")
    passed = violating == 0 or violating_pct <= dm
    return passed, {
        "shift_level": shift_level,
        "violating_value": str(violating),
        "violating_pct": str(round(violating_pct, 2)),
        "de_minimis": str(dm),
        "except_codes": list(except_codes or []),
        "components": detail,
    }


def _rvc_threshold_for(params, method, treaty):
    """Umbral de VCR para el método elegido. Si la regla trae rvc_options
    (biblioteca de PSR), usa el umbral específico de ese método; si no, cae al
    rvc_threshold de la regla o al umbral general del tratado."""
    for o in (params.get("rvc_options") or []):
        if o.get("method") == method:
            return Decimal(str(o["threshold"]))
    if params.get("rvc_threshold") is not None:
        return Decimal(str(params["rvc_threshold"]))
    if method == "net_cost":
        return Decimal(str(treaty.rvc_net_cost_threshold))
    return Decimal(str(treaty.rvc_transaction_threshold))


def _check_rvc(treaty, params, transaction_value, vnm):
    """Valor de Contenido Regional. RVC = (Valor - VNM) / Valor * 100."""
    method = params.get("rvc_method", "transaction")
    threshold = _rvc_threshold_for(params, method, treaty)
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
    if (params.get("extra") or {}).get("de_minimis_excluded"):
        de_minimis = 0  # la PSR excluye la tolerancia (p.ej. cap. 1-5 agrícolas)
    except_codes = params.get("ctc_except", [])

    ctc_pass = rvc_pass = None
    rvc_value = None

    if rt in ("CTC", "CTC_OR_RVC", "CTC_AND_RVC"):
        ctc_pass, ctc_detail = _check_tariff_shift(
            product, lines, shift_level, de_minimis, total, except_codes=except_codes)
        detail["tariff_shift"] = ctc_detail
    if rt in ("RVC", "CTC_OR_RVC", "CTC_AND_RVC"):
        rvc_pass, rvc_value, rvc_detail = _check_rvc(treaty, params, transaction_value, vnm)
        detail["rvc"] = rvc_detail

    note = automotive_note(params, product.hs_code or "")
    if note:
        detail["automotive_regime"] = note

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

    result = _result(passed, criterion, rvc_value, rule, detail)
    return apply_core_part_review(product.hs_code or "", result)


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
