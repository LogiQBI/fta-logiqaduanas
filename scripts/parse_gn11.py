"""Parser de la Nota General 11 del HTSUS (reglas de origen del USMCA).

Convierte el PDF oficial de la USITC en un CSV consumible por `import_rules`.
La salida es un BORRADOR auto-extraído: cubre los patrones regulares de salto
arancelario y VCR, pero DEBE revisarse contra el texto legal antes de producción
(las reglas tienen excepciones y casos especiales que un parser no captura al 100%).

Uso:
    python scripts/parse_gn11.py <ruta_pdf> <salida_csv>
"""
import csv
import re
import sys

from pypdf import PdfReader

CHAPTER_RE = re.compile(r"^Chapter (\d{1,2})\b", re.M)
# Captura cada enunciado de regla "A change to ... " hasta el siguiente.
RULE_RE = re.compile(r"A change to (.+?)(?=A change to |\nChapter \d|\Z)", re.S)
TARGET_RE = re.compile(
    r"(headings?|subheadings?|chapter)\s+(\d{4}\.\d{2}|\d{4}|\d{1,2})"
    r"(?:\s+through\s+(\d{4}\.\d{2}|\d{4}))?",
    re.I,
)
SHIFT_RE = re.compile(r"from any other (chapter|heading|subheading)", re.I)
RVC_RE = re.compile(r"regional value content of not less than", re.I)
PCT_RE = re.compile(r"(\d{1,2}(?:\.\d)?)\s*percent", re.I)

SHIFT_LEVEL = {"chapter": "CC", "heading": "CTH", "subheading": "CTSH"}


def clean(s):
    return re.sub(r"\s+", " ", s).strip()


def expand_headings(start, end):
    """Expande un rango de partidas de 4 dígitos: 0101..0106 -> [0101..0106]."""
    try:
        a, b = int(start), int(end)
    except ValueError:
        return [start]
    if b < a or b - a > 200:
        return [start]
    return [f"{n:04d}" for n in range(a, b + 1)]


def hs_patterns(kind, code, code_to):
    """Devuelve la lista de patrones HS para el objetivo de la regla."""
    kind = kind.lower()
    if kind.startswith("chapter"):
        return [f"{int(code):02d}"]
    if kind.startswith("heading"):
        if code_to:
            return expand_headings(code, code_to)
        return [code]
    # subheading
    code6 = code.replace(".", "")
    if code_to:
        # Rango de subpartidas: aproximamos al prefijo de partida(s) que cubre.
        return expand_headings(code[:4], code_to[:4])
    return [code6]


def parse(pdf_path):
    reader = PdfReader(pdf_path)
    text = "\n".join((pg.extract_text() or "") for pg in reader.pages)
    # Empezar en la sección de reglas de cambio de clasificación.
    start = text.find("Change in tariff classification rules")
    if start != -1:
        text = text[start:]

    rows = []
    seen = set()
    # Recorrer por capítulos.
    chapters = list(CHAPTER_RE.finditer(text))
    for i, ch in enumerate(chapters):
        ch_num = int(ch.group(1))
        block = text[ch.end(): chapters[i + 1].start() if i + 1 < len(chapters) else len(text)]
        for rule in RULE_RE.finditer(block):
            body = rule.group(1)
            tgt = TARGET_RE.match(clean(body)) or TARGET_RE.search(clean(body))
            shift = SHIFT_RE.search(body)
            if not tgt or not shift:
                continue
            level = SHIFT_LEVEL[shift.group(1).lower()]
            patterns = hs_patterns(tgt.group(1), tgt.group(2), tgt.group(3))

            has_rvc = bool(RVC_RE.search(body))
            no_change = "no change in tariff classification" in body.lower()
            if has_rvc and no_change:
                rule_type = "CTC_OR_RVC"
            elif has_rvc:
                rule_type = "CTC_AND_RVC"
            else:
                rule_type = "CTC"

            rvc_method, rvc_threshold = "", ""
            if has_rvc:
                pcts = PCT_RE.findall(body)
                rvc_method = "transaction"
                rvc_threshold = pcts[0] if pcts else "60"

            desc = clean(body)[:180]
            for pat in patterns:
                if pat in seen:
                    continue
                seen.add(pat)
                rows.append({
                    "treaty_code": "TMEC",
                    "hs_pattern": pat,
                    "rule_type": rule_type,
                    "shift_level": level if rule_type != "RVC" else "",
                    "rvc_method": rvc_method,
                    "rvc_threshold": rvc_threshold,
                    "de_minimis": "",
                    "description": f"[AUTO-GN11 cap.{ch_num}] {desc}",
                    "valid_from": "2020-07-01",
                })
    return rows


def main():
    if len(sys.argv) != 3:
        print("Uso: python scripts/parse_gn11.py <pdf> <csv>")
        sys.exit(1)
    rows = parse(sys.argv[1])
    cols = ["treaty_code", "hs_pattern", "rule_type", "shift_level", "rvc_method",
            "rvc_threshold", "de_minimis", "description", "valid_from"]
    with open(sys.argv[2], "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    print(f"Reglas extraídas: {len(rows)} -> {sys.argv[2]}")


if __name__ == "__main__":
    main()
