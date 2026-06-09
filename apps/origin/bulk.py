"""Carga masiva por Excel (.xlsx): plantillas e importadores por entidad.

Cada "tipo" define sus columnas (clave interna + etiqueta + ejemplo) y una
función importadora que hace upsert y devuelve un resumen {creados, actualizados,
errores}. Se usa para catálogos (productos/insumos, proveedores, clientes) y BOM.
"""
from decimal import Decimal, InvalidOperation
from io import BytesIO

import openpyxl
from openpyxl.styles import Font, PatternFill


def _dec(v):
    try:
        return Decimal(str(v).strip()) if v not in (None, "") else Decimal("0")
    except (InvalidOperation, ValueError):
        return Decimal("0")


def _digits(v, n=10):
    return "".join(c for c in str(v or "") if c.isdigit())[:n]


def _iso2(v):
    return "".join(c for c in str(v or "") if c.isalpha()).upper()[:2]


# Mapeo de tipo de producto en español -> clave del modelo.
KIND_MAP = {
    "material": "material", "insumo": "material", "materia prima": "material",
    "subensamble": "subassembly", "subassembly": "subassembly",
    "terminado": "finished", "producto terminado": "finished", "finished": "finished",
}


def import_products(tenant, rows, user):
    from apps.catalog.models import Party, Product
    res = {"creados": 0, "actualizados": 0, "errores": [], "advertencias": []}
    for i, r in enumerate(rows, start=2):
        sku = str(r.get("sku") or "").strip()
        if not sku:
            res["errores"].append({"fila": i, "error": "Falta SKU."}); continue
        kind = KIND_MAP.get(str(r.get("tipo") or "material").strip().lower(), "material")
        supplier = None
        scode = str(r.get("proveedor_codigo") or "").strip()
        if scode:
            supplier = Party.objects.filter(
                tenant=tenant, kind=Party.Kind.SUPPLIER, code__iexact=scode).first()
            if not supplier:
                # No bloquea: se crea el producto SIN proveedor y se avisa.
                res["advertencias"].append({"fila": i,
                    "error": f"Proveedor con código '{scode}' no existe; se creó sin proveedor."})
        defaults = {
            "description": str(r.get("descripcion") or "").strip(),
            "kind": kind,
            "hs_code": _digits(r.get("hs_code"), 8),
            "unit_cost": _dec(r.get("costo_unitario")),
            "currency": (str(r.get("moneda") or "USD").strip().upper() or "USD")[:3],
            "country_of_origin": _iso2(r.get("pais_origen")),
            "supplier": supplier,
        }
        _, created = Product.objects.update_or_create(tenant=tenant, sku=sku, defaults=defaults)
        res["creados" if created else "actualizados"] += 1
    return res


def _import_parties(tenant, rows, kind):
    from apps.catalog.models import Party
    res = {"creados": 0, "actualizados": 0, "errores": []}
    for i, r in enumerate(rows, start=2):
        name = str(r.get("nombre") or "").strip()
        if not name:
            res["errores"].append({"fila": i, "error": "Falta el nombre."}); continue
        code = str(r.get("codigo") or "").strip()
        defaults = {
            "country": _iso2(r.get("pais")), "tax_id": str(r.get("rfc") or "").strip(),
            "email": str(r.get("email") or "").strip(), "phone": str(r.get("telefono") or "").strip(),
        }
        # Buscar existente por código (si hay) o por nombre, dentro del tenant y tipo.
        existing = None
        if code:
            existing = Party.objects.filter(tenant=tenant, kind=kind, code__iexact=code).first()
        if not existing:
            existing = Party.objects.filter(tenant=tenant, kind=kind, name__iexact=name).first()
        if existing:
            existing.name = name
            if code:
                existing.code = code
            for k, v in defaults.items():
                setattr(existing, k, v)
            existing.save()
            res["actualizados"] += 1
        else:
            Party.objects.create(tenant=tenant, kind=kind, name=name, code=code, **defaults)
            res["creados"] += 1
    return res


def import_suppliers(tenant, rows, user):
    from apps.catalog.models import Party
    return _import_parties(tenant, rows, Party.Kind.SUPPLIER)


def import_customers(tenant, rows, user):
    from apps.catalog.models import Party
    return _import_parties(tenant, rows, Party.Kind.CUSTOMER)


def import_bom(tenant, rows, user):
    from apps.catalog.models import BOMComponent, Product
    res = {"creados": 0, "actualizados": 0, "errores": []}
    for i, r in enumerate(rows, start=2):
        psku = str(r.get("producto_sku") or "").strip()
        csku = str(r.get("insumo_sku") or "").strip()
        if not psku or not csku:
            res["errores"].append({"fila": i, "error": "Falta producto_sku o insumo_sku."}); continue
        parent = Product.objects.filter(tenant=tenant, sku=psku).first()
        component = Product.objects.filter(tenant=tenant, sku=csku).first()
        if not parent:
            res["errores"].append({"fila": i, "error": f"Producto '{psku}' no existe."}); continue
        if not component:
            res["errores"].append({"fila": i, "error": f"Insumo '{csku}' no existe."}); continue
        if parent.id == component.id:
            res["errores"].append({"fila": i, "error": "El producto no puede ser su propio insumo."}); continue
        pais = _iso2(r.get("pais_origen"))
        defaults = {"quantity": _dec(r.get("cantidad")) or Decimal("1")}
        if pais:
            defaults["origin_mode"] = "manual"
            defaults["manual_country"] = pais
        _, created = BOMComponent.objects.update_or_create(
            tenant=tenant, parent=parent, component=component, defaults=defaults)
        res["creados" if created else "actualizados"] += 1
    return res


# Definición de cada tipo de carga: hoja, columnas (clave, etiqueta, ejemplo) e importador.
SPECS = {
    "products": {
        "sheet": "Insumos y productos",
        "columns": [
            ("sku", "SKU / Núm. de parte", "MAT-001"),
            ("descripcion", "Descripción", "Lámina de acero"),
            ("tipo", "Tipo (material/subensamble/terminado)", "material"),
            ("hs_code", "Fracción HS (6 díg.)", "720839"),
            ("costo_unitario", "Costo unitario", "30.00"),
            ("moneda", "Moneda", "USD"),
            ("pais_origen", "País de origen (ISO-2)", "KR"),
            ("proveedor_codigo", "Código de proveedor (opcional)", "ST01"),
        ],
        "importer": import_products,
    },
    "suppliers": {
        "sheet": "Proveedores",
        "columns": [
            ("nombre", "Nombre / Razón social", "Componentes MX"),
            ("codigo", "Código de proveedor", "CMX01"),
            ("pais", "País (ISO-2)", "MX"),
            ("rfc", "RFC / Tax ID", "CMX010101AB1"),
            ("email", "Email", "contacto@proveedor.com"),
            ("telefono", "Teléfono", "8181818181"),
        ],
        "importer": import_suppliers,
    },
    "customers": {
        "sheet": "Clientes",
        "columns": [
            ("nombre", "Nombre / Razón social", "Importadora USA Inc"),
            ("codigo", "Código (opcional)", "CLI01"),
            ("pais", "País (ISO-2)", "US"),
            ("rfc", "RFC / Tax ID", "US-99-123"),
            ("email", "Email", "compras@cliente.com"),
            ("telefono", "Teléfono", "+1 555 0100"),
        ],
        "importer": import_customers,
    },
    "bom": {
        "sheet": "Lista de materiales (BOM)",
        "columns": [
            ("producto_sku", "SKU del producto (padre)", "FG-AUTO-01"),
            ("insumo_sku", "SKU del insumo (componente)", "MAT-001"),
            ("cantidad", "Cantidad", "1"),
            ("pais_origen", "País de origen manual (opcional, ISO-2)", "MX"),
        ],
        "importer": import_bom,
    },
}

# Columnas para responder una solicitud por BOM (proveedor).
BOM_RESPONSE_COLUMNS = [
    ("num_parte", "Número de parte", "CMP-001"),
    ("descripcion", "Descripción", "Resistencia"),
    ("hs_code", "Fracción HS (6 díg.)", "853321"),
    ("precio_unitario", "Precio unitario", "1.50"),
    ("cantidad", "Cantidad", "10"),
    ("pais", "País de origen (ISO-2)", "CN"),
    ("evidencia", "¿Tiene evidencia? (si/no)", "no"),
]


def make_template(columns, sheet_name):
    """Crea un .xlsx con encabezados (resaltados) + una fila de ejemplo. Devuelve bytes."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet_name[:31]
    header_font = Font(bold=True, color="FFFFFF")
    fill = PatternFill("solid", fgColor="043A70")
    for col, (_, label, example) in enumerate(columns, start=1):
        c = ws.cell(row=1, column=col, value=label)
        c.font = header_font
        c.fill = fill
        ws.cell(row=2, column=col, value=example)
        ws.column_dimensions[c.column_letter].width = max(14, len(label) + 2)
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def read_rows(file, columns):
    """Lee el .xlsx subido. La primera fila son encabezados (deben coincidir con
    las ETIQUETAS de la plantilla); devuelve una lista de dicts con las CLAVES."""
    wb = openpyxl.load_workbook(file, read_only=True, data_only=True)
    ws = wb.active
    rows_iter = ws.iter_rows(values_only=True)
    try:
        header = next(rows_iter)
    except StopIteration:
        return []
    # Mapear cada columna del archivo a su clave interna por la etiqueta.
    label_to_key = {label.strip().lower(): key for key, label, _ in columns}
    idx_to_key = {}
    for idx, h in enumerate(header):
        if h is None:
            continue
        key = label_to_key.get(str(h).strip().lower())
        if key:
            idx_to_key[idx] = key
    out = []
    for row in rows_iter:
        if row is None or all(v in (None, "") for v in row):
            continue
        d = {}
        for idx, key in idx_to_key.items():
            d[key] = row[idx] if idx < len(row) else None
        out.append(d)
    return out
