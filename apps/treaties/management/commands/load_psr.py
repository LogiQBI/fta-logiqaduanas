"""Carga reglas específicas de origen (PSR) CURADAS desde archivos JSON.

Los archivos viven en apps/treaties/data/psr_*.json y siguen el esquema de la
biblioteca de tratados: cada PSR trae rango SA, tipo de regla, nivel de salto,
opciones de VCR por método, excepciones de salto, texto auditable y datos
extra (régimen automotriz: LVC, acero/aluminio, core parts).

Estas reglas son de MAYOR calidad que las autogeneradas (GN11): tienen el texto
oficial y los parámetros finos que el motor (apps.origin.engine) ya sabe leer.

Uso:
  python manage.py load_psr                      # carga todos los psr_*.json
  python manage.py load_psr apps/.../psr_tmec.json   # un archivo específico
"""
import json
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from apps.treaties.models import OriginRule, Treaty

# Mapa: rule_type de la biblioteca -> rule_type del modelo OriginRule.
RULE_TYPE_MAP = {
    "wholly_obtained": "WO",
    "ctc": "CTC",
    "rvc": "RVC",
    "ctc_or_rvc": "CTC_OR_RVC",
    "ctc_and_rvc": "CTC_AND_RVC",
    "ctc_plus_condition": "CTC_AND_RVC",
    "specific_process": "CTC",
    "chapter_note": "CTC",
}
# Salto arancelario soportado por el motor (CTI 8 díg. se aproxima a subpartida).
CTC_LEVEL_MAP = {"CC": "CC", "CTH": "CTH", "CTSH": "CTSH", "CTI": "CTSH"}
# Método VCR de la biblioteca -> método que entiende el motor.
# El motor calcula (Valor - VNM)/Valor = build-down (equivalente a transacción
# sobre el valor del bien) y costo neto. build_up y focused_value usan fórmulas
# distintas (VOM/Valor, valor enfocado) que NO calculamos igual: se descartan
# para no dar un umbral incorrecto; se conserva el build-down/net_cost del PSR.
RVC_METHOD_MAP = {
    "transaction_value": "transaction",
    "build_down": "transaction",
    "net_cost": "net_cost",
}
LEVEL_DIGITS = {2: 2, 4: 4, 6: 6, 8: 8}


def _expand_hs(hs_from: str, hs_to: str, level: int, max_expand=500):
    """Convierte un rango SA en los prefijos a `level` dígitos que el motor usa.
    Ej.: 010000-059999 nivel 2 -> ['01','02','03','04','05']."""
    n = LEVEL_DIGITS.get(level, 6)
    df = "".join(c for c in str(hs_from) if c.isdigit())[:n]
    dt = "".join(c for c in str(hs_to) if c.isdigit())[:n]
    if not df:
        return []
    if not dt:
        dt = df
    a, b = int(df), int(dt)
    if b < a:
        a, b = b, a
    if (b - a) > max_expand:
        # Rango demasiado amplio: cae al prefijo común para no explotar el catálogo.
        return [df]
    return [str(i).zfill(n) for i in range(a, b + 1)]


class Command(BaseCommand):
    help = "Carga PSR curadas (psr_*.json) en OriginRule, por tratado."

    def add_arguments(self, parser):
        parser.add_argument("paths", nargs="*", help="Archivos JSON específicos (opcional).")

    def handle(self, *args, **options):
        data_dir = Path(settings.BASE_DIR) / "apps" / "treaties" / "data"
        paths = [Path(p) for p in options["paths"]] or sorted(data_dir.glob("psr_*.json"))
        if not paths:
            self.stdout.write(self.style.WARNING("No se encontraron archivos psr_*.json."))
            return

        def _digits(v, n):
            return "".join(c for c in str(v or "") if c.isdigit())[:n]

        total = 0
        for path in paths:
            data = json.loads(path.read_text(encoding="utf-8"))
            code = data["agreement"]
            treaty = Treaty.objects.filter(code=code).first()
            if not treaty:
                self.stdout.write(self.style.WARNING(
                    f"  {path.name}: tratado '{code}' no existe en el catálogo, se omite."))
                continue
            source_ref = data.get("source_ref", "")
            seen = set()
            objs = []
            for psr in data["psr"]:
                rule_type = RULE_TYPE_MAP.get(psr["rule_type"], "CTC")
                shift = CTC_LEVEL_MAP.get(psr.get("ctc_level") or "", "CTH")
                opts = []
                for o in psr.get("rvc_options", []):
                    m = RVC_METHOD_MAP.get(o.get("method"))
                    thr = o.get("threshold")
                    if not m or thr in (None, ""):
                        continue
                    try:
                        opts.append({"method": m, "threshold": float(thr)})
                    except (TypeError, ValueError):
                        continue
                default = next((o for o in opts if o["method"] == "transaction"),
                               opts[0] if opts else None)
                ctc_except = []
                for x in (psr.get("ctc_except") or []):
                    dd = "".join(c for c in str(x) if c.isdigit())
                    if len(dd) >= 4:
                        ctc_except.append(dd)
                level = int(psr.get("hs_level") or 6)
                params = {
                    "shift_level": shift, "ctc_except": ctc_except, "rvc_options": opts,
                    "extra": psr.get("extra", {}),
                    "source_ref": psr.get("source_ref", source_ref),
                    "rule_text_en": psr.get("rule_text_en", ""), "hs_level": level,
                }
                if default:
                    params["rvc_method"] = default["method"]
                    params["rvc_threshold"] = default["threshold"]
                if psr.get("de_minimis") is not None:
                    params["de_minimis"] = float(psr["de_minimis"])
                desc = psr.get("rule_text_es", "")
                # Cobertura: general (patrón vacío) o por RANGO (sin expandir).
                if psr.get("general"):
                    hs_pattern, hf, ht, lvl = "", "", "", None
                else:
                    hf = _digits(psr.get("hs_from"), level)
                    ht = _digits(psr.get("hs_to") or psr.get("hs_from"), level) or hf
                    if not hf:
                        continue
                    lvl = level
                    hs_pattern = hf if hf == ht else f"{hf}-{ht}"
                if hs_pattern in seen:
                    continue  # evita choque de unique (treaty, hs_pattern)
                seen.add(hs_pattern)
                objs.append(OriginRule(
                    treaty=treaty, hs_pattern=hs_pattern, rule_type=rule_type,
                    params=params, description=desc, hs_from=hf, hs_to=ht, hs_level=lvl))
            # T-MEC convive con las reglas GN11 (CSV): no borrar, upsert. Los demás
            # tratados son 100% de anexo: borrar e insertar en bloque (rápido, limpio).
            if code == "TMEC":
                for o in objs:
                    OriginRule.objects.update_or_create(
                        treaty=treaty, hs_pattern=o.hs_pattern,
                        defaults={"rule_type": o.rule_type, "params": o.params,
                                  "description": o.description, "hs_from": o.hs_from,
                                  "hs_to": o.hs_to, "hs_level": o.hs_level})
            else:
                OriginRule.objects.filter(treaty=treaty).delete()
                OriginRule.objects.bulk_create(objs, batch_size=1000)
            total += len(objs)
            self.stdout.write(f"  {path.name}: {len(objs)} reglas -> {code}")

        self.stdout.write(self.style.SUCCESS(f"\nPSR cargadas: {total} reglas en total."))
