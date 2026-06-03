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
