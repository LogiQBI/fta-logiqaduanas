"""Importa reglas de origen (OriginRule) desde un archivo CSV.

Este es el mecanismo escalable para cargar los datasets oficiales completos
(Anexo 4-B del USMCA, reglas de cada TLC, etc.).

Uso:
    python manage.py import_rules apps/treaties/data/rules_starter.csv

Columnas esperadas del CSV:
    treaty_code, hs_pattern, rule_type, shift_level, rvc_method,
    rvc_threshold, de_minimis, description, valid_from
"""
import csv
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.utils.dateparse import parse_date

from apps.treaties.models import OriginRule, Treaty


class Command(BaseCommand):
    help = "Importa reglas de origen (OriginRule) desde un CSV."

    def add_arguments(self, parser):
        parser.add_argument("csv_path", help="Ruta al archivo CSV con las reglas.")

    def handle(self, *args, **options):
        path = Path(options["csv_path"])
        if not path.exists():
            raise CommandError(f"No existe el archivo: {path}")

        treaties = {t.code: t for t in Treaty.objects.all()}
        created = updated = skipped = 0

        with path.open(newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                code = (row.get("treaty_code") or "").strip()
                treaty = treaties.get(code)
                if not treaty:
                    self.stderr.write(f"  ! Tratado desconocido '{code}', fila saltada.")
                    skipped += 1
                    continue

                params = {}
                if row.get("shift_level"):
                    params["shift_level"] = row["shift_level"].strip()
                if row.get("rvc_method"):
                    params["rvc_method"] = row["rvc_method"].strip()
                if row.get("rvc_threshold"):
                    params["rvc_threshold"] = float(row["rvc_threshold"])
                if row.get("de_minimis"):
                    params["de_minimis"] = float(row["de_minimis"])

                _, was_created = OriginRule.objects.update_or_create(
                    treaty=treaty,
                    hs_pattern=(row.get("hs_pattern") or "").strip(),
                    defaults={
                        "rule_type": (row.get("rule_type") or "").strip(),
                        "params": params,
                        "description": (row.get("description") or "").strip(),
                        "valid_from": parse_date(row["valid_from"]) if row.get("valid_from") else None,
                    },
                )
                created += int(was_created)
                updated += int(not was_created)

        self.stdout.write(self.style.SUCCESS(
            f"Reglas importadas: {created} nuevas, {updated} actualizadas, {skipped} saltadas. "
            f"Total en catálogo: {OriginRule.objects.count()}."))
