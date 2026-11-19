/**
 * What the `'render'` insert calls after a component renders: hand it the element, and it decides
 * whether anything inside needs loading.
 *
 * Deliberately the narrowest contract rather than a description of `@verajs/autoloader`'s instance,
 * which accepts more (a shadow root, a document, or nothing) and carries `url`/`retry` besides — see
 * `AutoloaderInstance` there. Widening this would stop a hand-written two-line autoloader from
 * satisfying it, which is the opposite of the point.
 */
export type Autoloader = (element: HTMLElement) => void;



/**
 * A constructed stylesheet paired with its source text — what core's `css` tag produces and what
 * `@verajs/styles` adopts. Shared here because two packages speak it; each re-exports it so its own
 * public surface is unchanged.
 */
export type CSSResultGroup = { styleSheet: CSSStyleSheet; cssText: string };

/** A component's render: run on its first pass and again when what it read changes */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Renderer = (template: any, container: HTMLElement | ShadowRoot, ...args: any[]) => any;

/* ── Spoken by @verajs/core and @verajs/lite (moved from core's types, 2026-11-17); each re-exports what it uses ── */

/** Which kind of template a result is, numbered as lit numbers them: 1 html, 2 svg, 3 mathml. */
export type ResultType = 1 | 2 | 3;

/**
 * The object core's `html`, `svg` and `mathml` tags produce. Structurally compatible with lit-html's
 * `TemplateResult`, so a lit renderer consumes it directly.
 */
export type TemplateResult<T extends ResultType = 1> = {
  _$litType$: T;
  strings: TemplateStringsArray;
  values: unknown[];
};
/** `define`'s `methods`: functions only, installed on the generated prototype (an accessor is a prop's job). */
export type Methods = Record<string, (...args: never[]) => unknown>;
/** `data-count` → `dataCount`: the prop an observed attribute arrives as. */
export type Camel<S extends string> = S extends `${infer H}-${infer T}` ? `${H}${Capitalize<Camel<T>>}` : S;
/**
 * The props once the observed attributes join them: each attribute is a `string | null` prop under its camel name, and a
 * declared prop it SHARES widens to its default's type `| string | null` — the platform writes strings, so the type says so.
 */
export type WithAttributes<P, A extends readonly string[]> = Omit<P, Camel<A[number]>> & {
  [K in A[number] as Camel<K>]: (Camel<K> extends keyof P ? P[Camel<K>] : never) | string | null;
};
/** What `signal()` returns: one value, read and written as `.value`. */
export type Signal<T> = { value: T };
