/* Núcleo de i18n SIN dependencias de React (lo importa el runtime JSX, que
 * también se usa en Server Components). El idioma canónico del código es el
 * español; el inglés sale del diccionario (match exacto o patrones). Lo que no
 * esté en el diccionario se muestra en español (fallback seguro). */
import { EN, EN_PATTERNS } from "./dict";

export type Lang = "es" | "en";

let current: Lang = "es";
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

export function subscribeLang(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function setLang(l: Lang) {
  if (l === current) return;
  current = l;
  try { localStorage.setItem("fta_lang", l); } catch {}
  listeners.forEach((fn) => fn());
}

// Carga el idioma guardado DESPUÉS de montar (evita desajustes de hidratación
// con el HTML pre-renderizado, igual que se hace con el tema oscuro).
export function initLangFromStorage() {
  try {
    const saved = localStorage.getItem("fta_lang");
    if (saved === "en" || saved === "es") setLang(saved);
  } catch {}
}

/** Traduce un texto al idioma activo. En español regresa el texto tal cual. */
export function t(s: string): string {
  if (current !== "en" || !s) return s;
  const direct = EN[s];
  if (direct !== undefined) return direct;
  const trimmed = s.trim();
  const hit = EN[trimmed];
  if (hit !== undefined) {
    // Conserva los espacios originales alrededor (JSX los usa para separar).
    const lead = s.match(/^\s*/)![0];
    const tail = s.match(/\s*$/)![0];
    return lead + hit + tail;
  }
  for (const [re, rep] of EN_PATTERNS) {
    if (re.test(s)) return s.replace(re, rep);
  }
  return s;
}
