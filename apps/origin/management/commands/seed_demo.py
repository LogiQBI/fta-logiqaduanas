"""Carga datos demo (tenant, T-MEC, productos, BOM) y corre la calificación.

Uso:  python manage.py seed_demo
"""
from datetime import date
from decimal import Decimal

from django.core.management.base import BaseCommand

from apps.catalog.models import BOMComponent, Party, Product
from apps.origin.services import qualify_and_save
from apps.tenants.models import Tenant
from apps.treaties.models import OriginRule, Treaty


class Command(BaseCommand):
    help = "Carga datos de demostración y ejecuta la calificación de origen."

    def handle(self, *args, **options):
        # --- Tenant ---
        tenant, _ = Tenant.objects.get_or_create(
            slug="demo", defaults={"name": "Demo Manufacturing SA de CV", "rfc": "DEM010101AAA"}
        )

        # --- Tratado T-MEC con una regla data-driven ---
        tmec, _ = Treaty.objects.update_or_create(
            code="TMEC",
            defaults={
                "name": "Tratado entre México, EE.UU. y Canadá",
                "member_countries": ["MX", "US", "CA"],
                "rvc_transaction_threshold": Decimal("60"),
                "rvc_net_cost_threshold": Decimal("50"),
                "de_minimis_pct": Decimal("10"),
                "in_force_from": date(2020, 7, 1),
            },
        )
        OriginRule.objects.update_or_create(
            treaty=tmec, hs_pattern="8537",
            defaults={
                "rule_type": "CTC_OR_RVC",
                "params": {"shift_level": "CTH", "rvc_method": "transaction", "rvc_threshold": 60},
                "description": "Cambio de partida (CTH) o VCR ≥ 60% (valor de transacción).",
            },
        )

        # --- Proveedores ---
        prov_mx, _ = Party.objects.get_or_create(
            tenant=tenant, kind="supplier", name="Componentes MX", defaults={"country": "MX"})
        prov_cn, _ = Party.objects.get_or_create(
            tenant=tenant, kind="supplier", name="Imports China", defaults={"country": "CN"})

        # --- Materiales ---
        mat_mx, _ = Product.objects.update_or_create(
            tenant=tenant, sku="MAT-MX-001",
            defaults={"description": "Carcasa metálica (MX)", "kind": "material",
                      "hs_code": "732690", "unit_cost": Decimal("70"), "currency": "USD",
                      "country_of_origin": "MX", "supplier": prov_mx})
        mat_cn, _ = Product.objects.update_or_create(
            tenant=tenant, sku="MAT-CN-001",
            defaults={"description": "Relé electrónico (CN)", "kind": "material",
                      "hs_code": "853690", "unit_cost": Decimal("30"), "currency": "USD",
                      "country_of_origin": "CN", "supplier": prov_cn})

        # --- Producto terminado: tablero eléctrico HS 8537 ---
        tablero, _ = Product.objects.update_or_create(
            tenant=tenant, sku="FG-TABLERO-01",
            defaults={"description": "Tablero de control eléctrico", "kind": "finished",
                      "hs_code": "853710", "unit_cost": Decimal("100"), "currency": "USD"})
        BOMComponent.objects.get_or_create(tenant=tenant, parent=tablero, component=mat_mx,
                                           defaults={"quantity": Decimal("1")})
        BOMComponent.objects.get_or_create(tenant=tenant, parent=tablero, component=mat_cn,
                                           defaults={"quantity": Decimal("1")})

        # --- Calificar ---
        q = qualify_and_save(tablero, tmec)

        self.stdout.write(self.style.SUCCESS("\n=== RESULTADO DE CALIFICACIÓN ==="))
        self.stdout.write(f"Producto : {tablero.sku} — {tablero.description} (HS {tablero.hs_code})")
        self.stdout.write(f"Tratado  : {tmec.code}")
        self.stdout.write(f"Estado   : {q.get_status_display()}")
        self.stdout.write(f"Criterio : {q.criterion}")
        self.stdout.write(f"VCR      : {q.rvc_value}%")
        ts = q.detail.get("tariff_shift", {})
        rvc = q.detail.get("rvc", {})
        self.stdout.write(f"Salto arancelario: viola {ts.get('violating_pct')}% (de minimis {ts.get('de_minimis')}%)")
        self.stdout.write(f"VCR detalle: {rvc.get('rvc')}% vs umbral {rvc.get('threshold')}% ({rvc.get('method')})")
        self.stdout.write(self.style.SUCCESS("================================\n"))
