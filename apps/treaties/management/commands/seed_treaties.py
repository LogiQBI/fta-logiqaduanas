"""Carga el catálogo de los tratados de libre comercio de México.

Uso:  python manage.py seed_treaties

NOTA: member_countries, nombres y códigos son datos firmes. Los umbrales de VCR
y de minimis son VALORES POR DEFECTO razonables; los umbrales reales varían por
tratado y por producto y deben capturarse en las reglas de origen (OriginRule).
T-MEC se carga con sus valores oficiales (60 % transacción / 50 % costo neto / 10 %).
"""
from datetime import date

from django.core.management.base import BaseCommand

from apps.treaties.models import Treaty

UE27 = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
        "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
        "SI", "ES", "SE"]

# (código, nombre, países miembro [sin contar MX], vcr_tx, vcr_nc, de_minimis, vigor)
TREATIES = [
    ("TMEC", "T-MEC — México, EE.UU. y Canadá", ["US", "CA"], 60, 50, 10, date(2020, 7, 1)),
    ("TLCUEM", "TLC México-Unión Europea (Acuerdo Global)", UE27, 50, 40, 10, date(2000, 7, 1)),
    ("AELC", "TLC México-AELC (Suiza, Noruega, Islandia, Liechtenstein)",
     ["CH", "NO", "IS", "LI"], 50, 40, 10, date(2001, 7, 1)),
    ("ISRAEL", "TLC México-Israel", ["IL"], 50, 40, 10, date(2000, 7, 1)),
    ("CHILE", "TLC México-Chile", ["CL"], 50, 40, 10, date(1999, 8, 1)),
    ("COLOMBIA", "TLC México-Colombia", ["CO"], 50, 40, 10, date(1995, 1, 1)),
    ("CENTROAMERICA", "TLC México-Centroamérica",
     ["CR", "SV", "GT", "HN", "NI"], 50, 40, 10, date(2013, 9, 1)),
    ("URUGUAY", "TLC México-Uruguay", ["UY"], 50, 40, 10, date(2004, 7, 15)),
    ("JAPON", "Acuerdo de Asociación Económica México-Japón", ["JP"], 50, 40, 10, date(2005, 4, 1)),
    ("PANAMA", "TLC México-Panamá", ["PA"], 50, 40, 10, date(2015, 7, 1)),
    ("PERU", "Acuerdo de Integración Comercial México-Perú", ["PE"], 50, 40, 10, date(2012, 2, 1)),
    ("CPTPP", "Tratado Integral y Progresista de Asociación Transpacífico (TPP11)",
     ["AU", "BN", "CA", "CL", "JP", "MY", "NZ", "PE", "SG", "VN", "GB"], 45, 40, 10, date(2018, 12, 30)),
    ("ALIANZA_PACIFICO", "Alianza del Pacífico", ["CL", "CO", "PE"], 50, 40, 10, date(2016, 5, 1)),
    ("REINO_UNIDO", "Acuerdo de Continuidad Comercial México-Reino Unido",
     ["GB"], 50, 40, 10, date(2021, 6, 1)),
]


class Command(BaseCommand):
    help = "Carga el catálogo de los TLC de México (datos del motor data-driven)."

    def handle(self, *args, **options):
        creados = actualizados = 0
        for code, name, members, vcr_tx, vcr_nc, dm, vigor in TREATIES:
            _, created = Treaty.objects.update_or_create(
                code=code,
                defaults={
                    "name": name,
                    "member_countries": ["MX"] + members,
                    "rvc_transaction_threshold": vcr_tx,
                    "rvc_net_cost_threshold": vcr_nc,
                    "de_minimis_pct": dm,
                    "in_force_from": vigor,
                },
            )
            creados += int(created)
            actualizados += int(not created)
            self.stdout.write(f"  {'+ ' if created else '~ '}{code}: {name}")

        total = Treaty.objects.count()
        self.stdout.write(self.style.SUCCESS(
            f"\nTratados cargados: {creados} nuevos, {actualizados} actualizados. "
            f"Total en catálogo: {total}."))
        self.stdout.write(self.style.WARNING(
            "Recuerda: los umbrales VCR/de minimis son DEFAULTS (salvo T-MEC). "
            "Las reglas reales por producto se cargan en OriginRule."))
