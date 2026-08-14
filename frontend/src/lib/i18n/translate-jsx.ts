/* Traducción automática de props/children de JSX (la usan jsx-runtime.ts y
 * jsx-dev-runtime.ts). Solo se tocan strings: los que están en el diccionario
 * salen traducidos, el resto pasa intacto. */
import { t } from "./core";

// Props de texto visibles al usuario que se traducen además de children.
const TEXT_PROPS = new Set(["placeholder", "title", "label", "desc", "hint", "head", "caption"]);

function trChild(c: unknown): unknown {
  return typeof c === "string" ? t(c) : c;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function translateProps(props: any): any {
  if (!props) return props;
  let out = props;
  const copy = () => { if (out === props) out = { ...props }; };

  const ch = props.children;
  if (typeof ch === "string") {
    copy(); out.children = t(ch);
  } else if (Array.isArray(ch) && ch.some((c) => typeof c === "string")) {
    copy(); out.children = ch.map(trChild);
  }

  for (const k of Object.keys(props)) {
    if (!TEXT_PROPS.has(k)) continue;
    const v = props[k];
    if (typeof v === "string") { copy(); out[k] = t(v); }
    else if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      copy(); out[k] = v.map((x) => t(x));
    }
  }
  return out;
}
