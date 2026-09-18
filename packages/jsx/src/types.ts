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
    /**
     * **Interfaces on purpose, and the one place in this package where §1's `type` rule yields.**
     *
     * `JSX.IntrinsicElements` is a contract a CONSUMER extends: a TSX app adds its own custom
     * elements to it by declaration merging —
     * `declare global { namespace JSX { interface IntrinsicElements { 'my-card': {…} } } }` —
     * which is the capability §1 calls "genuine extension" and the reason interfaces exist at all.
     * A type alias cannot merge, so converting these would silently remove the only way a TSX user
     * can type their own elements. Verified by compiling exactly that augmentation against these
     * declarations before the rule was applied to the rest of the file.
     */
    // eslint-disable-next-line no-restricted-syntax -- declaration merging is the point; see above
    interface IntrinsicElements {
      [tagName: string]: Record<string, unknown>;
    }
    // eslint-disable-next-line no-restricted-syntax -- ditto: tsc reads this by shape, and it merges
    interface ElementChildrenAttribute {
      children: object;
    }
  }
}

export type VeraJsxOptions = {
  /** Skip auto-injecting `html`/`keyed`/`spread` imports. */
  inject?: boolean;
  /** [importedName, moduleSpecifier] for the template tag. Default ['html', '@verajs/core']. */
  html?: [string, string];
  /** [importedName, moduleSpecifier] for keyed(). Default ['keyed', '@verajs/renderer/keyed']. */
  keyed?: [string, string];
  /** [importedName, moduleSpecifier] for spread(). Default ['spread', '@verajs/renderer/spread']. */
  spread?: [string, string];
  /** [importedName, moduleSpecifier] for the SVG template tag — expressions inside `<svg>` compile
   *  their roots with it, so mapped shapes parse in the SVG namespace. Default ['svg', '@verajs/core']. */
  svg?: [string, string];
  /** The same, for content inside `<math>`. Default ['mathml', '@verajs/core']. */
  mathml?: [string, string];
};

/** The lexical walker's cursor — a plain record; `createParseState` builds one. */
export type ParseState = {
  readonly code: string;
  i: number;
  /** The last significant character / word seen, for the expression-position heuristic. */
  lastChar: string;
  lastWord: string;
  /** The one reportable parse failure — see `createParseState`'s doc in parser.ts. */
  mismatch: JsxMismatch | null;
};

export type JsxMismatch = {
  expected: string;
  found: string;
  at: number;
};

/** A named attribute (`kind` says how its value arrived) or a `{...spread}`. */
export type JsxAttribute =
  | { spread: true; text: string; roots: JsxRoot[]; start: number; valueStart: number }
  | { spread?: undefined; name: string; kind: 'none'; start: number }
  | { spread?: undefined; name: string; kind: 'str'; text: string; start: number }
  | { spread?: undefined; name: string; kind: 'expr'; text: string; roots: JsxRoot[]; start: number; valueStart: number };

export type JsxNode =
  | { fragment: true; children: JsxChild[]; start: number }
  /**
   * `selfClosing` records how the author SPELLED the tag, which is not how it is emitted: HTML
   * decides that by element, so the transform reads `VOID_ELEMENTS` instead (see `emitInto`). The
   * field stays because the parser's job is to report the source faithfully — a diagnostic that
   * wants to speak about what was written needs it, and the emitter's choice not to is the
   * emitter's.
   */
  | { fragment?: undefined; tag: string; attrs: JsxAttribute[]; selfClosing: boolean; children: JsxChild[]; start: number };

export type JsxChild =
  | { text: string }
  | { expr: string; roots: JsxRoot[]; exprStart: number }
  | JsxNode;

/** One top-level JSX region in a source file: the slice bounds and its parsed tree. */
export type JsxRoot = {
  start: number;
  end: number;
  node: JsxNode;
};
