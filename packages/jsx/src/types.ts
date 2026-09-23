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
    /**
     * **What every element and COMPONENT may carry on top of its own props.**
     *
     * This is the half `IntrinsicElements` cannot reach. A dash-named tag goes through the index
     * signature above and accepts anything; a FUNCTION COMPONENT is checked against its own
     * parameter type instead, so `<Card key={id} title="x" />` was `TS2322 — Property 'key' does
     * not exist on type '{ title: string }'` while compiling and running perfectly. The transform
     * handles `key` in both emitters on purpose (`tpl.setKey` for an element, and the component
     * emitter lifts it out of the props bag), so the types were forbidding a feature the compiler
     * implements — the worst kind of gap, because the fix people reach for is a cast.
     *
     * `unknown` rather than React's `string | number`: this renderer compares keys by value and
     * `TemplateResult.key` is `unknown`, so anything usable as an identity is legitimate here.
     */
    // eslint-disable-next-line no-restricted-syntax -- ditto: tsc reads this by shape, and it merges
    interface IntrinsicAttributes {
      key?: unknown;
    }
  }
}

/**
 * What `transformJsx(source, filename, options)` and the bundler plugins accept.
 *
 * Every entry but `inject` names an import as `[importedName, moduleSpecifier]`, which is how the
 * output is retargeted at a different renderer without touching a line of JSX — point `html` at
 * your own tag and the compiled templates call it instead. `inject: false` suppresses the import
 * statements while still emitting the calls, for a file that already has them in scope.
 */
export type VeraJsxOptions = {
  /** Skip auto-injecting `html`/`keyed`/`spread` imports. */
  inject?: boolean;
  /** [importedName, moduleSpecifier] for the template tag. Default ['html', '@verajs/core']. */
  html?: [string, string];
  /** [importedName, moduleSpecifier] for keyed(). Default ['keyed', '@verajs/renderer/keyed']. */
  keyed?: [string, string];
  /** [importedName, moduleSpecifier] for spread(). Default ['spread', '@verajs/renderer/spread']. */
  spread?: [string, string];
};

/** The lexical walker's cursor — a plain record; `createParseState` builds one. */
export type ParseState = {
  readonly code: string;
  i: number;
  /** The last significant character / word seen, for the expression-position heuristic. */
  lastChar: string;
  /**
   * The meaningful character BEFORE `lastChar`, and whether a line break falls between `lastChar`
   * and the cursor. Both are maintained forwards, where comments are already invisible, because the
   * backward scans they replace could not be: one landed on the closing slash of a block comment and
   * read the comment itself as an operator, so a postfix increment followed by a comment and a
   * division lost every root in the module.
   */
  lastPrev: string;
  /**
   * The word `lastPrev` completed, if it completed one. `lastPrev` alone cannot tell `a!` from
   * `return !`: both put a word character before the `!`, and only the word says which it is.
   */
  lastPrevWord: string;
  brokeLine: boolean;
  lastWord: string;
  /** The reportable parse failure — see `createParseState`'s doc in parser.ts. */
  mismatch: JsxFault | null;
};

/**
 * A parse failure the walker REPORTS rather than shrugging at, already worded.
 *
 * Only the FIRST is kept: after one the walker's idea of the source is already wrong, so every later
 * complaint is a consequence of it and naming them all buries the real cause. `at` is a character
 * offset into the original source, so the caller can turn it into a line and column.
 */
export type JsxFault = {
  message: string;
  at: number;
};

/** A named attribute (`kind` says how its value arrived) or a `{...spread}`. */
export type JsxAttribute =
  | { spread: true; text: string; roots: JsxRoot[]; start: number; valueStart: number }
  | { spread?: undefined; name: string; kind: 'none'; start: number }
  | { spread?: undefined; name: string; kind: 'str'; text: string; start: number }
  | { spread?: undefined; name: string; kind: 'expr'; text: string; roots: JsxRoot[]; start: number; valueStart: number };

/**
 * One element or fragment in the parsed tree, discriminated on `fragment`.
 *
 * `start` is an offset into the original source and is carried on every node so a diagnostic can
 * point at the JSX the author wrote rather than at the generated template.
 */
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

/**
 * What can sit inside an element: literal text, an `{expression}`, or a nested node.
 *
 * Text is kept verbatim rather than trimmed — whitespace between inline elements is significant in
 * HTML, and the emitter is the only place that knows enough to decide what to collapse.
 */
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
