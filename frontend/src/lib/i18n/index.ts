/* API de i18n para componentes de CLIENTE (el hook usa React). El núcleo sin
 * React vive en core.ts (lo comparte el runtime JSX). Ver dict.ts para el
 * diccionario ES→EN. */
"use client";
import { useSyncExternalStore } from "react";
import { getLang, subscribeLang } from "./core";
import type { Lang } from "./core";

export { getLang, initLangFromStorage, setLang, t } from "./core";
export type { Lang };

// Suscripción para que TODA la app se re-renderice al cambiar el idioma.
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLang, () => "es");
}
