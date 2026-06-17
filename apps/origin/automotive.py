"""Régimen automotriz del T-MEC (USMCA) — evaluación de los pilares.

Un vehículo (o autoparte core) NO califica solo por el VCR: debe pasar varias
pruebas simultáneas. Este módulo evalúa, para una fecha dada (phase-in):

  1) RVC por COSTO NETO (umbral por clase y año).
  2) Valor de Contenido Laboral (LVC): % mínimo + salario base ≥ 16 USD/h.
  3) Compra de acero norteamericano ≥ 70%.
  4) Compra de aluminio norteamericano ≥ 70%.
  5) Core / super-core parts originarios.

Veredicto: califica solo si TODOS los pilares pasan.

AVISO: es una herramienta orientativa. Los umbrales y fechas del T-MEC deben
confirmarse contra la normativa vigente (Capítulo 4 y Reglamentaciones
Uniformes) y validarse con un especialista antes de uso formal ante la autoridad.
"""
from datetime import date
from decimal import Decimal


def _d(x):
    try:
        return Decimal(str(x if x not in (None, "") else 0))
    except Exception:
        return Decimal("0")


# Clases de bien automotor
CLASSES = ["passenger", "light_truck", "heavy", "autopart"]
CLASS_LABEL = {
    "passenger": "Automóvil de pasajeros",
    "light_truck": "Camión ligero",
    "heavy": "Vehículo pesado",
    "autopart": "Autoparte (core)",
}


def rvc_threshold(vehicle_class, as_of):
    """RVC por costo neto exigido, con phase-in por fecha."""
    y = as_of or date(2023, 7, 1)
    if vehicle_class == "heavy":
        if y < date(2024, 7, 1):
            return Decimal("60")
        if y < date(2027, 7, 1):
            return Decimal("64")
        return Decimal("70")
    if vehicle_class == "autopart":
        # Autoparte core: 75% costo neto (referencia).
        return Decimal("75")
    # Pasajeros y camión ligero
    if y < date(2021, 7, 1):
        return Decimal("66")
    if y < date(2022, 7, 1):
        return Decimal("69")
    if y < date(2023, 7, 1):
        return Decimal("72")
    return Decimal("75")


def lvc_threshold(vehicle_class, as_of):
    """LVC (Valor de Contenido Laboral) exigido, con phase-in para pasajeros."""
    if vehicle_class in ("light_truck", "heavy"):
        return Decimal("45")
    if vehicle_class == "autopart":
        return Decimal("0")  # no aplica LVC a autopartes individuales
    y = as_of or date(2023, 7, 1)
    if y < date(2021, 7, 1):
        return Decimal("30")
    if y < date(2022, 7, 1):
        return Decimal("33")
    if y < date(2023, 7, 1):
        return Decimal("36")
    return Decimal("40")


STEEL_ALUMINUM_PCT = Decimal("70")
WAGE_MIN_USD_H = Decimal("16")

# VCR de referencia para una AUTOPARTE esencial (core) — Anexo 4-B.
# Una autoparte se determina SOLO por VCR; el LVC y el acero/aluminio son
# requisitos del VEHÍCULO, no de la parte.
PART_RVC = {"net_cost": Decimal("75"), "transaction": Decimal("85")}


def _evaluate_part(as_of, rvc_method, net_cost, transaction_value, vnm,
                   lvc_pct=None, wage_usd_h=None):
    """Una AUTOPARTE (core) se determina solo por VCR (costo neto o valor de
    transacción). NO aplican LVC ni acero/aluminio (esos son del vehículo).

    El LVC es OPCIONAL e INFORMATIVO: algunas OEM piden al proveedor reportar el
    Contenido de Valor Laboral de su parte. No cambia la determinación de origen de
    la autoparte; solo se reporta."""
    method = "transaction" if rvc_method == "transaction" else "net_cost"
    base = _d(transaction_value) if method == "transaction" else _d(net_cost)
    vnm_d = _d(vnm)
    thr = PART_RVC[method]
    base_label = "valor de transacción" if method == "transaction" else "costo neto"
    if base > 0:
        rvc = ((base - vnm_d) / base * 100).quantize(Decimal("0.01"))
        ok = rvc >= thr
        detail = f"VCR {rvc}% ({base_label} {base}, materiales no originarios {vnm_d})."
    else:
        rvc = None
        ok = False
        detail = f"Falta el {base_label} del bien para calcular el VCR."
    pillar = {"key": "rvc", "label": f"VCR ({base_label})",
              "value": str(rvc) if rvc is not None else None,
              "threshold": str(thr), "ok": ok, "detail": detail}
    pillars = [pillar]

    # LVC opcional (informativo). El proveedor reporta el % de contenido de valor
    # laboral de su parte y, si lo tiene, el salario base. NO afecta el veredicto.
    if lvc_pct not in (None, ""):
        lvc_v = _d(lvc_pct)
        if wage_usd_h not in (None, ""):
            wage = _d(wage_usd_h)
            wage_txt = (f" con mano de obra a {wage} USD/h "
                        f"({'≥' if wage >= WAGE_MIN_USD_H else '<'} {WAGE_MIN_USD_H} USD/h de alto salario)")
        else:
            wage_txt = ""
        pillars.append({
            "key": "lvc", "label": "Contenido de Valor Laboral (LVC) — informativo",
            "value": str(lvc_v), "threshold": "—", "ok": True, "informational": True,
            "detail": (f"Contenido de Valor Laboral reportado: {lvc_v}%{wage_txt}. "
                       f"Es un requisito del VEHÍCULO (no de la autoparte); se reporta "
                       f"porque algunas OEM lo solicitan. No afecta el origen de la parte."),
        })

    return {
        "vehicle_class": "autopart", "class_label": "Autoparte esencial (core)",
        "as_of": as_of.isoformat() if as_of else None,
        "qualifies": ok, "pillars": pillars, "failing": [] if ok else [pillar["label"]],
        "rvc_value": str(rvc) if rvc is not None else None, "rvc_method": method,
        "disclaimer": ("Para una AUTOPARTE el origen se determina por el VCR; NO aplican "
                       "el Valor de Contenido Laboral ni la compra de acero/aluminio (esos son "
                       "requisitos del fabricante del VEHÍCULO). Umbral de referencia para parte "
                       "esencial: 75% costo neto / 85% valor de transacción. Muchas autopartes "
                       "también pueden calificar por salto arancelario (CTC) según su PSR. "
                       "Orientativo; valida con un especialista."),
    }


def evaluate(*, vehicle_class, as_of, net_cost, vnm, lvc_pct, wage_usd_h,
             steel_na_pct, aluminum_na_pct, core_parts_originating,
             rvc_method="net_cost", transaction_value=None):
    """Evalúa el régimen automotriz. Para AUTOPARTE: solo VCR. Para VEHÍCULO: los
    5 pilares (VCR + LVC + acero + aluminio + core parts)."""
    if vehicle_class == "autopart":
        return _evaluate_part(as_of, rvc_method, net_cost, transaction_value, vnm,
                              lvc_pct=lvc_pct, wage_usd_h=wage_usd_h)
    nc = _d(net_cost)
    vnm_d = _d(vnm)
    pillars = []

    # 1) RVC por costo neto
    rvc_thr = rvc_threshold(vehicle_class, as_of)
    if nc > 0:
        rvc = (nc - vnm_d) / nc * 100
        rvc = rvc.quantize(Decimal("0.01"))
        rvc_ok = rvc >= rvc_thr
        rvc_detail = f"VCR {rvc}% (costo neto {nc}, VNM {vnm_d})"
    else:
        rvc = None
        rvc_ok = False
        rvc_detail = "Falta el costo neto para calcular el VCR."
    pillars.append({"key": "rvc", "label": "VCR por costo neto",
                    "value": str(rvc) if rvc is not None else None,
                    "threshold": str(rvc_thr), "ok": rvc_ok, "detail": rvc_detail})

    # 2) LVC
    lvc_thr = lvc_threshold(vehicle_class, as_of)
    lvc_v = _d(lvc_pct)
    wage = _d(wage_usd_h)
    if vehicle_class == "autopart":
        lvc_ok = True
        lvc_detail = "LVC no aplica a autopartes individuales."
    else:
        wage_ok = wage >= WAGE_MIN_USD_H
        lvc_ok = lvc_v >= lvc_thr and wage_ok
        lvc_detail = (f"LVC {lvc_v}% (umbral {lvc_thr}%); salario base {wage} USD/h "
                      f"({'≥' if wage_ok else '<'} {WAGE_MIN_USD_H} USD/h requerido).")
    pillars.append({"key": "lvc", "label": "Valor de Contenido Laboral (LVC)",
                    "value": str(lvc_v), "threshold": str(lvc_thr), "ok": lvc_ok,
                    "detail": lvc_detail})

    # 3) Acero
    steel = _d(steel_na_pct)
    steel_ok = steel >= STEEL_ALUMINUM_PCT
    mp_note = ""
    if as_of and as_of >= date(2027, 7, 1):
        mp_note = " Aplica regla 'melted and poured' (fundido y vaciado en la región)."
    pillars.append({"key": "steel", "label": "Compra de acero norteamericano",
                    "value": str(steel), "threshold": str(STEEL_ALUMINUM_PCT), "ok": steel_ok,
                    "detail": f"Acero N.A. {steel}% (≥ {STEEL_ALUMINUM_PCT}%).{mp_note}"})

    # 4) Aluminio
    alu = _d(aluminum_na_pct)
    alu_ok = alu >= STEEL_ALUMINUM_PCT
    pillars.append({"key": "aluminum", "label": "Compra de aluminio norteamericano",
                    "value": str(alu), "threshold": str(STEEL_ALUMINUM_PCT), "ok": alu_ok,
                    "detail": f"Aluminio N.A. {alu}% (≥ {STEEL_ALUMINUM_PCT}%)."})

    # 5) Core / super-core
    core_ok = bool(core_parts_originating)
    pillars.append({"key": "core", "label": "Core / super-core parts originarios",
                    "value": "Sí" if core_ok else "No", "threshold": "Sí", "ok": core_ok,
                    "detail": ("Los 7 sistemas core (motor, transmisión, carrocería/chasis, ejes, "
                               "suspensión, dirección y batería en EV) deben ser originarios "
                               "(75% costo neto con roll-up super-core).")})

    qualifies = all(p["ok"] for p in pillars)
    fallan = [p["label"] for p in pillars if not p["ok"]]
    return {
        "vehicle_class": vehicle_class,
        "class_label": CLASS_LABEL.get(vehicle_class, vehicle_class),
        "as_of": as_of.isoformat() if as_of else None,
        "qualifies": qualifies,
        "pillars": pillars,
        "failing": fallan,
        "rvc_value": str(rvc) if rvc is not None else None,
        "disclaimer": ("Herramienta orientativa del régimen automotriz T-MEC. Califica solo si "
                       "los 5 pilares pasan. Además se requieren 3 certificaciones a CBP (LVC, "
                       "acero, aluminio). Verifica umbrales/fechas contra la normativa vigente y "
                       "valida con un especialista antes de uso formal."),
    }
