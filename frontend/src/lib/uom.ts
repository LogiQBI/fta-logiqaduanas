// Catálogo de unidades de medida (UOM) para las líneas de BOM.
// Códigos de 2 caracteres alfanuméricos. Refleja apps/catalog/uom.py.
export const UOM_OPTIONS: { code: string; label: string }[] = [
  { code: "PZ", label: "Pieza" },
  { code: "UN", label: "Unidad" },
  { code: "KG", label: "Kilogramo" },
  { code: "GR", label: "Gramo" },
  { code: "MG", label: "Miligramo" },
  { code: "TN", label: "Tonelada" },
  { code: "LB", label: "Libra" },
  { code: "OZ", label: "Onza" },
  { code: "MT", label: "Metro" },
  { code: "CM", label: "Centímetro" },
  { code: "MM", label: "Milímetro" },
  { code: "M2", label: "Metro cuadrado" },
  { code: "M3", label: "Metro cúbico" },
  { code: "FT", label: "Pie" },
  { code: "IN", label: "Pulgada" },
  { code: "LT", label: "Litro" },
  { code: "ML", label: "Mililitro" },
  { code: "GL", label: "Galón" },
  { code: "PR", label: "Par" },
  { code: "JG", label: "Juego" },
  { code: "KT", label: "Kit" },
  { code: "CJ", label: "Caja" },
  { code: "RL", label: "Rollo" },
  { code: "HJ", label: "Hoja" },
];

export const UOM_CODES = new Set(UOM_OPTIONS.map((u) => u.code));

export function uomLabel(code: string): string {
  const u = UOM_OPTIONS.find((o) => o.code === code);
  return u ? `${u.code} — ${u.label}` : code;
}
