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
    a, b = int(hs_from[:n]), int(hs_to[:n])
    if b < a:
        a, b = b, a
    if (b - a) > max_expand:
        # Rango demasiado amplio: cae al prefijo común para no explotar el catálogo.
        return [hs_from[:n]]
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

        total_creadas = total_actualizadas = total_omitidas = 0
        for path in paths:
            data = json.loads(path.read_text(encoding="utf-8"))
            code = data["agreement"]
            treaty = Treaty.objects.filter(code=code).first()
            if not treaty:
                self.stdout.write(self.style.WARNING(
                    f"  {path.name}: tratado '{code}' no existe en el catálogo, se omite."))
                continue
            source_ref = data.get("source_ref", "")
            for psr in data["psr"]:
                rule_type = RULE_TYPE_MAP.get(psr["rule_type"], "CTC")
                shift = CTC_LEVEL_MAP.get(psr.get("ctc_level") or "", "CTH")
                # Opciones de VCR mapeadas a métodos del motor (se omiten métodos
                # no computables como build_up/focused_value).
                opts = []
                for o in psr.get("rvc_options", []):
                    m = RVC_METHOD_MAP.get(o.get("method"))
                    if m:
                        opts.append({"method": m, "threshold": float(o["threshold"])})
                # Método y umbral por defecto: prioriza valor de transacción.
                default = next((o for o in opts if o["method"] == "transaction"),
                               opts[0] if opts else None)
                params = {
                    "shift_level": shift,
                    "ctc_except": psr.get("ctc_except", []),
                    "rvc_options": opts,
                    "extra": psr.get("extra", {}),
                    "source_ref": psr.get("source_ref", source_ref),
                    "rule_text_en": psr.get("rule_text_en", ""),
                    "hs_level": psr.get("hs_level"),
                }
                if default:
                    params["rvc_method"] = default["method"]
                    params["rvc_threshold"] = default["threshold"]
                if psr.get("de_minimis") is not None:
                    params["de_minimis"] = float(psr["de_minimis"])
                desc = psr.get("rule_text_es", "")
                # Regla GENERAL/residual del tratado: patrón vacío = aplica a todo
                # (el motor usa la PSR más específica si existe; ésta es el respaldo).
                if psr.get("general"):
                    hs_list = [""]
                else:
                    hs_list = _expand_hs(psr["hs_from"], psr["hs_to"], psr.get("hs_level", 6))
                for hs in hs_list:
                    _, created = OriginRule.objects.update_or_create(
                        treaty=treaty, hs_pattern=hs,
                        defaults={"rule_type": rule_type, "params": params,
                                  "description": desc})
                    total_creadas += int(created)
                    total_actualizadas += int(not created)
            self.stdout.write(f"  {path.name}: {len(data['psr'])} PSR -> {code}")

        self.stdout.write(self.style.SUCCESS(
            f"\nPSR cargadas: {total_creadas} nuevas, {total_actualizadas} actualizadas."))
