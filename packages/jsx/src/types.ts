/**
 * The package's shared types — one `types.ts` at the import-graph root, per CODE-PRINCIPLES §1.
 * The parser's node shapes live here because parser and transform both speak them; the ambient
 * JSX namespace lives here because it is the package's TSX-consumer contract and must travel
 * with the generated declarations.
 */

/**
 * Permissive TSX typings: every element accepts every prop, so TSX compiles today. The fully
 * typed IntrinsicElements surface is the known long tail. Use with `"jsx": "preserve"` — the
 * plugin, not tsc, transforms JSX.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    type Element = unknown;
    interface IntrinsicElements {
      [tagName: string]: Record<string, unknown>;
    }
    interface ElementChildrenAttribute {
      children: object;
    }
  }
}

export interface VeraJsxOptions {
  /** Skip auto-injecting `html`/`keyed`/`spread` imports. */
  inject?: boolean;
  /** [importedName, moduleSpecifier] for the template tag. Default ['html', '@verajs/core']. */
  html?: [string, string];
  /** [importedName, moduleSpecifier] for keyed(). Default ['keyed', '@verajs/renderer/keyed']. */
  keyed?: [string, string];
  /** [importedName, moduleSpecifier] for spread(). Default ['spread', '@verajs/renderer/spread']. */
  spread?: [string, string];
}

/** The lexical walker's cursor — a plain record; `createParseState` builds one. */
export interface ParseState {
  readonly code: string;
  i: number;
  /** The last significant character / word seen, for the expression-position heuristic. */
  lastChar: string;
  lastWord: string;
  /** The one reportable parse failure — see `createParseState`'s doc in parser.ts. */
  mismatch: JsxMismatch | null;
}

export interface JsxMismatch {
  expected: string;
  found: string;
  at: number;
}

/** A named attribute (`kind` says how its value arrived) or a `{...spread}`. */
export type JsxAttribute =
  | { spread: true; text: string; roots: JsxRoot[]; start: number; valueStart: number }
  | { spread?: undefined; name: string; kind: 'none'; start: number }
  | { spread?: undefined; name: string; kind: 'str'; text: string; start: number }
  | { spread?: undefined; name: string; kind: 'expr'; text: string; roots: JsxRoot[]; start: number; valueStart: number };

export type JsxNode =
  | { fragment: true; children: JsxChild[]; start: number }
  | { fragment?: undefined; tag: string; attrs: JsxAttribute[]; selfClosing: boolean; children: JsxChild[]; start: number };

export type JsxChild =
  | { text: string }
  | { expr: string; roots: JsxRoot[]; exprStart: number }
  | JsxNode;

/** One top-level JSX region in a source file: the slice bounds and its parsed tree. */
export interface JsxRoot {
  start: number;
  end: number;
  node: JsxNode;
}
