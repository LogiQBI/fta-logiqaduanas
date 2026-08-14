/* Runtime JSX con traducción automática (desarrollo). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as R from "react/jsx-dev-runtime";
import { translateProps } from "./translate-jsx";

export type { JSX } from "./jsx-runtime";

export const Fragment = (R as any).Fragment;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function jsxDEV(type: any, props: any, key: any, isStatic: any, source: any, self: any) {
  return (R as any).jsxDEV(type, translateProps(props), key, isStatic, source, self);
}
