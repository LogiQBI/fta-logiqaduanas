"""Crea usuarios de demo para probar empresa vs proveedor (solo desarrollo).

- empresa1 (rol admin): ve todo el tenant.
- proveedor_cn (rol supplier → Imports China): solo ve lo suyo.
- proveedor_mx (rol supplier → Componentes MX): solo ve lo suyo.

Uso:  python manage.py seed_users
"""
from django.contrib.auth.models import User
from django.core.management.base import BaseCommand

from apps.catalog.models import Party
from apps.tenants.models import Membership, Tenant

DEMO_PASSWORD = "demo12345"


class Command(BaseCommand):
    help = "Crea usuarios demo (empresa y proveedores) para probar el aislamiento."

    def _user(self, username):
        u, created = User.objects.get_or_create(username=username)
        u.set_password(DEMO_PASSWORD)
        u.save()
        return u

    def handle(self, *args, **options):
        tenant = Tenant.objects.get(slug="demo")
        prov_cn = Party.objects.filter(tenant=tenant, name="Imports China").first()
        prov_mx = Party.objects.filter(tenant=tenant, name="Componentes MX").first()

        # Empresa (ve todo)
        empresa = self._user("empresa1")
        Membership.objects.update_or_create(
            user=empresa, tenant=tenant, defaults={"role": "admin", "party": None})

        # Proveedores (cada uno ve solo lo suyo)
        for username, party in [("proveedor_cn", prov_cn), ("proveedor_mx", prov_mx)]:
            if not party:
                continue
            u = self._user(username)
            Membership.objects.update_or_create(
                user=u, tenant=tenant, defaults={"role": "supplier", "party": party})

        self.stdout.write(self.style.SUCCESS("Usuarios demo creados (contraseña: demo12345):"))
        self.stdout.write("  empresa1      -> empresa (ve TODO)")
        self.stdout.write(f"  proveedor_cn  -> proveedor: {prov_cn.name if prov_cn else 'N/A'}")
        self.stdout.write(f"  proveedor_mx  -> proveedor: {prov_mx.name if prov_mx else 'N/A'}")
