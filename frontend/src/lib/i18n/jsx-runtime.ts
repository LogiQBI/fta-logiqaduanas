/* Runtime JSX con traducción automática (producción).
 * Activado vía tsconfig.json → "jsxImportSource": "@/lib/i18n". */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as R from "react/jsx-runtime";
import type { JSX as ReactJSX } from "react/jsx-runtime";
import { translateProps } from "./translate-jsx";

// TypeScript toma los tipos de JSX del import source: re-usamos los de React.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace JSX {
  export type ElementType = ReactJSX.ElementType;
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface Element extends ReactJSX.Element {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface ElementClass extends ReactJSX.ElementClass {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface ElementAttributesProperty extends ReactJSX.ElementAttributesProperty {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface ElementChildrenAttribute extends ReactJSX.ElementChildrenAttribute {}
  export type LibraryManagedAttributes<C, P> = ReactJSX.LibraryManagedAttributes<C, P>;
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface IntrinsicAttributes extends ReactJSX.IntrinsicAttributes {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface IntrinsicClassAttributes<T> extends ReactJSX.IntrinsicClassAttributes<T> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface IntrinsicElements extends ReactJSX.IntrinsicElements {}
}

export const Fragment = (R as any).Fragment;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function jsx(type: any, props: any, key: any) {
  return (R as any).jsx(type, translateProps(props), key);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function jsxs(type: any, props: any, key: any) {
  return (R as any).jsxs(type, translateProps(props), key);
}
