"""Limpia entradas de histórico de PRECIO que no representan un cambio real.

Antes se comparaba el valor crudo del Excel (p. ej. 11.207008) contra el valor
guardado (11.2070, 4 decimales), generando un "cambio" falso en cada carga masiva.
Esta migración borra esos registros: kind=price donde el precio (a 4 decimales) y
la moneda no cambiaron. Los cambios reales (precio o moneda distintos) se conservan.
"""
from decimal import Decimal, ROUND_HALF_UP

from django.db import migrations

_Q = Decimal("0.0001")


def _currency_of(text):
    parts = (text or "").split()
    return parts[-1] if (len(parts) >= 2 and parts[-1].isalpha()) else ""


def purge_noop_price_logs(apps, schema_editor):
    PCL = apps.get_model("catalog", "ProductChangeLog")
    borrar = []
    for log in PCL.objects.filter(kind="price").iterator():
        if log.old_price is None or log.new_price is None:
            continue
        mismo_precio = (log.old_price.quantize(_Q, ROUND_HALF_UP)
                        == log.new_price.quantize(_Q, ROUND_HALF_UP))
        misma_moneda = _currency_of(log.old_value) == _currency_of(log.new_value)
        if mismo_precio and misma_moneda:
            borrar.append(log.pk)
    if borrar:
        PCL.objects.filter(pk__in=borrar).delete()


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("catalog", "0023_bomcomponent_uom_solicitationbomline_uom"),
    ]

    operations = [
        migrations.RunPython(purge_noop_price_logs, noop),
    ]
