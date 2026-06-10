"""Catálogo de unidades de medida (UOM) para las líneas de BOM.

Códigos de 2 caracteres alfanuméricos. Se usan tanto en el BOM de la EMPRESA
(BOMComponent) como en el del PROVEEDOR (SolicitationBOMLine), en la captura
manual (desplegable) y en la carga por layout. El catálogo del front
(frontend/src/lib/uom.ts) debe reflejar esta misma lista."""

UOM_CHOICES = [
    ("PZ", "Pieza"),
    ("UN", "Unidad"),
    ("KG", "Kilogramo"),
    ("GR", "Gramo"),
    ("MG", "Miligramo"),
    ("TN", "Tonelada"),
    ("LB", "Libra"),
    ("OZ", "Onza"),
    ("MT", "Metro"),
    ("CM", "Centímetro"),
    ("MM", "Milímetro"),
    ("M2", "Metro cuadrado"),
    ("M3", "Metro cúbico"),
    ("FT", "Pie"),
    ("IN", "Pulgada"),
    ("LT", "Litro"),
    ("ML", "Mililitro"),
    ("GL", "Galón"),
    ("PR", "Par"),
    ("JG", "Juego"),
    ("KT", "Kit"),
    ("CJ", "Caja"),
    ("RL", "Rollo"),
    ("HJ", "Hoja"),
]

UOM_CODES = {code for code, _ in UOM_CHOICES}


def clean_uom(value):
    """Normaliza un valor a un código UOM válido (2 caracteres en mayúsculas).
    Devuelve "" si está vacío o no pertenece al catálogo."""
    if not value:
        return ""
    code = "".join(ch for ch in str(value).strip().upper() if ch.isalnum())[:2]
    return code if code in UOM_CODES else ""
