"""Arranque idempotente para el despliegue (Railway).

Se ejecuta en cada deploy (después de `migrate`). Es seguro repetirlo:

1. Garantiza el superusuario (master) para el acceso de administrador.
   Credenciales por variables de entorno, con los mismos valores que en local
   por defecto (ADMIN_USERNAME=admin / ADMIN_PASSWORD=admin12345).

2. Si SEED_DEMO=1 (valor por defecto mientras es demo), siembra los datos de
   prueba (empresa "demo", productos, proveedores y usuarios empresa1/proveedor_*).
   Cuando el sistema tenga datos reales, basta poner SEED_DEMO=0 en Railway.

Uso:  python manage.py bootstrap_prod
"""
import os

from django.contrib.auth.models import User
from django.core.management import call_command
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Arranque idempotente de producción: superusuario + datos demo opcionales."

    def handle(self, *args, **options):
        username = os.environ.get("ADMIN_USERNAME", "admin")
        password = os.environ.get("ADMIN_PASSWORD", "admin12345")
        email = os.environ.get("ADMIN_EMAIL", "")

        user, created = User.objects.get_or_create(
            username=username, defaults={"email": email})
        # Asegura privilegios de master y la contraseña esperada.
        user.is_staff = True
        user.is_superuser = True
        if password:
            user.set_password(password)
        user.save()
        verbo = "creado" if created else "actualizado"
        self.stdout.write(self.style.SUCCESS(
            f"Superusuario '{username}' {verbo} (master)."))

        if os.environ.get("SEED_DEMO", "1") == "1":
            self.stdout.write("SEED_DEMO=1 -> sembrando datos demo…")
            call_command("seed_demo")
            call_command("seed_users")
            self.stdout.write(self.style.SUCCESS("Datos demo listos."))
        else:
            self.stdout.write("SEED_DEMO!=1 -> se omite el sembrado demo.")

        # Catálogo de reglas de origen (PSR). El starter es chico (reglas
        # genéricas por capítulo) -> siempre, idempotente. El GN11 es grande
        # (~1466) -> solo si el catálogo está casi vacío.
        from pathlib import Path

        from django.conf import settings

        from apps.treaties.models import OriginRule

        data = Path(settings.BASE_DIR) / "apps" / "treaties" / "data"
        starter = data / "rules_starter.csv"
        gn11 = data / "usmca_gn11_auto.csv"
        if starter.exists():
            call_command("import_rules", str(starter))
        if gn11.exists() and OriginRule.objects.count() < 1000:
            self.stdout.write("Cargando catálogo completo de reglas (GN11)…")
            call_command("import_rules", str(gn11))

        # Asegura el catálogo de los TLC de México (idempotente).
        call_command("seed_treaties")
        # PSR curadas (texto auditable + RVC multi-método + régimen automotriz).
        # Se cargan DESPUÉS de las GN11 para que sobrescriban las autogeneradas.
        self.stdout.write("Cargando PSR curadas (biblioteca de tratados)…")
        call_command("load_psr")
