"""Carga el catálogo de TLC de Estados Unidos.

El sistema se venderá también a empresas de EE.UU., así que se incluyen los
acuerdos que usa Estados Unidos. Los códigos llevan prefijo 'US_' para no
confundirlos con los TLC de México (p. ej. US-Chile ≠ México-Chile: distintas
reglas de origen).

Uso:  python manage.py seed_us_treaties

NOTA: USMCA (lado EE.UU.) es el mismo acuerdo que el T-MEC ya cargado (código TMEC).
Los umbrales VCR son DEFAULTS; las reglas reales por producto van en OriginRule.
"""
from datetime import date

from django.core.management.base import BaseCommand

from apps.treaties.models import Treaty

# (código, nombre, países miembro [sin contar US], vcr_tx, vcr_nc, de_minimis, vigor)
US_TREATIES = [
    ("US_KORUS", "TLC Estados Unidos-Corea (KORUS)", ["KR"], 45, 35, 10, date(2012, 3, 15)),
    ("US_CAFTA_DR", "CAFTA-DR (Centroamérica y Rep. Dominicana)",
     ["CR", "SV", "GT", "HN", "NI", "DO"], 45, 35, 10, date(2006, 3, 1)),
    ("US_CHILE", "TLC Estados Unidos-Chile", ["CL"], 45, 35, 10, date(2004, 1, 1)),
    ("US_COLOMBIA", "TLC Estados Unidos-Colombia", ["CO"], 45, 35, 10, date(2012, 5, 15)),
    ("US_PERU", "TLC Estados Unidos-Perú", ["PE"], 45, 35, 10, date(2009, 2, 1)),
    ("US_PANAMA", "TLC Estados Unidos-Panamá", ["PA"], 45, 35, 10, date(2012, 10, 31)),
    ("US_SINGAPORE", "TLC Estados Unidos-Singapur", ["SG"], 45, 35, 10, date(2004, 1, 1)),
    ("US_AUSTRALIA", "TLC Estados Unidos-Australia", ["AU"], 45, 35, 10, date(2005, 1, 1)),
    ("US_MOROCCO", "TLC Estados Unidos-Marruecos", ["MA"], 35, 35, 10, date(2006, 1, 1)),
    ("US_BAHRAIN", "TLC Estados Unidos-Baréin", ["BH"], 35, 35, 10, date(2006, 8, 1)),
    ("US_OMAN", "TLC Estados Unidos-Omán", ["OM"], 35, 35, 10, date(2009, 1, 1)),
    ("US_JORDAN", "TLC Estados Unidos-Jordania", ["JO"], 35, 35, 10, date(2001, 12, 17)),
    ("US_ISRAEL", "TLC Estados Unidos-Israel", ["IL"], 35, 35, 10, date(1985, 9, 1)),
]


class Command(BaseCommand):
    help = "Carga el catálogo de TLC de Estados Unidos (para clientes en EE.UU.)."

    def handle(self, *args, **options):
        creados = actualizados = 0
        for code, name, members, vcr_tx, vcr_nc, dm, vigor in US_TREATIES:
            _, created = Treaty.objects.update_or_create(
                code=code,
                defaults={
                    "name": name,
                    "member_countries": ["US"] + members,
                    "rvc_transaction_threshold": vcr_tx,
                    "rvc_net_cost_threshold": vcr_nc,
                    "de_minimis_pct": dm,
                    "in_force_from": vigor,
                },
            )
            creados += int(created)
            actualizados += int(not created)
            self.stdout.write(f"  {'+ ' if created else '~ '}{code}: {name}")

        self.stdout.write(self.style.SUCCESS(
            f"\nTLC de EE.UU.: {creados} nuevos, {actualizados} actualizados. "
            f"Total tratados en catálogo: {Treaty.objects.count()}."))
        self.stdout.write(self.style.WARNING(
            "USMCA (lado EE.UU.) = T-MEC (código TMEC). Umbrales VCR son DEFAULTS; "
            "las reglas por producto van en OriginRule (import_rules)."))
