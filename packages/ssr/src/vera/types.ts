/**
 * `@verajs/ssr`'s cross-file and public types (CODE-PRINCIPLES §1 Types). It imports nothing from inside this package,
 * so it sits at the root of the package's import graph; a type that NAMES one of this package's runtime classes (the
 * DOM shim's `ElementShim` and the rest) cannot be hoisted above that class, and stays beside it in `nodes.ts`.
 * A type one file uses stays in that file, unexported.
 */

/**
 * A template value as the serializer receives it: a tagged template literal's result, or data shaped like one. `strings`
 * is `unknown` on purpose — only a literal's strings array, which owns `raw`, makes a template (`isLiteral` in
 * `serializer.ts`); anything else is rendered as the text any object renders as, never as markup.
 */
export type SsrTemplate = {
  readonly strings: unknown;
  readonly values: readonly unknown[];
  readonly _$litType$?: number;
};

/** The custom-element definitions this process has seen, by tag name — filled as component modules execute. */
export type SsrRegistry = Map<string, CustomElementConstructor>;

/**
 * The options `renderToString` and `renderToStringAsync` take — each one is documented on `renderToString`. Checked at
 * run time too, so a JavaScript caller passing the wrong kind of value gets a `TypeError` naming the option.
 */
export type SsrRenderOptions = {
  readonly tag?: string;
  readonly attributes?: string | Record<string, unknown>;
  readonly props?: Record<string, unknown>;
  readonly children?: string;
  readonly seen?: Set<string>;
  readonly base?: string | URL;
  readonly static?: boolean;
  readonly location?: string | URL;
};

/**
 * What a render resolves to: the entry element's markup, the hoisted styles this render is responsible for (escaped, for
 * the caller to place in a `<style>`), and the document title the render left set.
 */
export type SsrRenderResult = {
  html: string;
  styles: string;
  title: string;
};
