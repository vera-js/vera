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

/**
 * **The tag scanner's state** (`tokenizer.ts`), shared by the template compiler and the `.innerHTML` and component
 * scans. Internal to this package: nothing in its public API names these.
 */
/**
 * An element that changes how what follows it parses, as the scan opened it: its name (what closes it, and what a
 * template's end writes to close it), the foreign depth BEFORE it (restored when it closes), and the namespace its
 * content is read in — `html`, `svg`, `math`, or `''` when unknown (a template that starts at a foreign depth its
 * parent gave it cannot know which namespace that is, so it recognizes no integration point: the safe side).
 */
export type Open = { readonly name: string; readonly foreign: number; readonly space: string };
export type Phase = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
/** Where the scan stands at the end of a static — carried into the next one, and what a template's end must close. */
export type ScanState = {
  readonly inTag: boolean;
  /** Which tokenizer state the tag being read is in — `OUTSIDE` when there is none (see the phases above). */
  readonly phase: Phase;
  readonly inValue: boolean;
  readonly quote: string;
  readonly rawTag: string;
  readonly tagName: string;
  readonly attrName: string;
  readonly serial: number;
  readonly closing: boolean;
  readonly inert: number;
  /** The open comment's closer — `-->` for a comment, `>` for a bogus one (`<!x`, `<?x`, `</ x`) — or `''`. */
  readonly comment: string;
  readonly textTag: string;
  readonly foreign: number;
  /** Mutated by `scanTag`, so every fresh state owns its own. */
  readonly opens: Open[];
  /** The `encoding` of the tag being read, while one is — what makes an `annotation-xml` an integration point. */
  readonly encoding: string;
  readonly attrRaw: string;
};
/** A state before any static has been scanned: it carries none of the offsets a scan reports about its own text. */
export interface ScanStart extends ScanState {
  readonly opened?: undefined;
  readonly attrStart?: undefined;
  readonly valueStart?: undefined;
  readonly nameAt?: undefined;
  readonly tagAt?: undefined;
}
/** What `scanTag` answers: the state carried on, and where in THIS text the last attribute to open here starts. */
export interface ScanResult extends ScanState {
  readonly opened: boolean;
  readonly attrStart: number;
  readonly valueStart: number;
  /** Where, in THIS text, the name of the attribute whose value opened here starts — `0` when it began earlier. */
  readonly nameAt: number;
  /** Where, in THIS text, the tag still open at its end began — `-1` when it began in an earlier one, or none is. */
  readonly tagAt: number;
}

/**
 * A tag the component scan collects (`scanTag`'s `tags`): its span in the markup, its name as the tokenizer reads it,
 * whether it is an end tag, and whether it is LIVE — a start tag in HTML, where the parser creates an element a custom
 * element definition upgrades (never inside `<svg>`/`<math>` outside an integration point). Only names with a `-`
 * are collected, and none inside `<template>` content.
 */
export type ScannedTag = { readonly at: number; readonly end: number; readonly name: string; readonly closing: boolean; readonly live: boolean };
