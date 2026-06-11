"""Reclasifica las calificaciones YA guardadas de partes esenciales (core parts).

Antes, una core part del cap. 87 (p. ej. 8708.80 suspensión) podía quedar como
"Califica" por el salto arancelario simple. Con la nueva política, esas partes
requieren el régimen automotriz: se marcan como 'AUTO_REVIEW'. Esta migración
corrige las calificaciones existentes que dicen QUALIFIES y son core parts.
"""
from django.db import migrations


def flag_core_parts(apps, schema_editor):
    from apps.origin.engine import core_part_code, CORE_PART_NOTE
    Qualification = apps.get_model("origin", "Qualification")
    qs = Qualification.objects.filter(status="QUALIFIES").select_related("product")
    for q in qs.iterator():
        code = core_part_code(getattr(q.product, "hs_code", "") or "")
        if not code:
            continue
        q.status = "AUTO_REVIEW"
        detail = q.detail if isinstance(q.detail, dict) else {}
        detail["automotive_core"] = CORE_PART_NOTE
        detail["automotive_core_code"] = code
        q.detail = detail
        q.save(update_fields=["status", "detail", "updated_at"])


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("origin", "0005_alter_qualification_status"),
    ]

    operations = [
        migrations.RunPython(flag_core_parts, noop),
    ]
