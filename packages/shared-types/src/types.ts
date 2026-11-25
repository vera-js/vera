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
/** A name-and-prose pair, which is the shape most of a surface's sections are. */
type Described = {
  readonly name: string;
  readonly description: string;
};

/**
 * The shape every component's surface declaration satisfies — `src/<component>/surface.ts` in each component
 * package. Here, in the one private types package, so every component declares against one shape (a copy per
 * component would drift); type-only, so it is inlined into each package's `.d.ts` and no consumer meets this name.
 *
 * A surface is the component's public API written as DATA, and three things are generated from or
 * checked against it: `custom-elements.json` (the ecosystem-standard manifest, diffed by the gate
 * so an API change without its manifest diff refuses), the docs page, and the runtime drift test
 * that renders the component and rejects a part or slot the declaration does not carry. Renaming
 * anything in a surface is a breaking change by definition; that is the point of writing it down.
 *
 * **Declare one with `as const satisfies ComponentSurface`, never with a type annotation.** The two
 * are not interchangeable here. An annotation widens every string to `string` and throws away the
 * literal vocabulary the manifest generator and the docs page read; `satisfies` checks the object
 * against this shape while leaving `tag` as `'vera-select'` and a part's name as `'menu'`. It is
 * also what catches a malformed surface — a mistyped `descriptoin` is a compile error naming the
 * intended key, where before it would have traveled silently into the manifest.
 *
 * This was `typeof selectSurface` until 2026-09-17, which read as a cross-component contract and
 * could not be one: `typeof` on an `as const` object is the type of THAT object, `tag: 'vera-select'`
 * literal included, so no second component could ever satisfy it. Nothing used it, so nothing had
 * noticed.
 */
export type ComponentSurface = {
  /** The registered tag name. */
  readonly tag: string;
  /** One paragraph: what the component is and the decisions a consumer makes about it. */
  readonly description: string;
  readonly attributes: readonly Described[];
  /** `type` is the public TypeScript spelling a consumer would write, not the internal one. */
  readonly properties: readonly (Described & { readonly type: string })[];
  /** `detail` describes the event's payload, or says plainly that there is none. */
  readonly events: readonly (Described & { readonly detail: string })[];
  readonly methods: readonly Described[];
  readonly slots: readonly Described[];
  readonly parts: readonly Described[];
  /**
   * Observable state reflected onto a part, for styling and for tests — `on` names the part,
   * `values` the complete vocabulary of that attribute.
   */
  readonly states: readonly {
    readonly on: string;
    readonly attribute: string;
    readonly values: readonly string[];
  }[];
  /** `ElementInternals` custom states, reachable from CSS as `:state(name)`. */
  readonly customStates: readonly Described[];
  /** Every CSS custom property the component reads. */
  readonly tokens: readonly string[];
};

/**
 * **The states a component is shown in, as data** — `src/<component>/demo.ts` in each component package, beside its
 * surface, declared `as const satisfies ComponentDemo`. The preview page is generated from every package's demo, and
 * `tests/component-demos.test.mjs` holds each one to its surface: every state renders with no warning, and every
 * attribute and part the surface declares appears in some state. That check reads the RENDERED DOM, so a part the
 * user writes (a prefix the demo's markup supplies) counts, and so does a part that is present but hidden, but never
 * the user's markup parked out of sight by light-DOM slots.
 *
 * Markup only, no script, so a demo stays readable by anything and buildless. A part that is not in the DOM until the
 * reader does something (a caps-lock hint after a key press) is listed in `interactive` with how to reach it, which the
 * check accepts as covered and the page shows. Demos are not published: `files` ships `dist` and the manifest only.
 */
export type ComponentDemo = {
  /** What the reviewer is asked to judge: the look, the wording, the behavior worth trying. One or two sentences. */
  readonly ask: string;
  /** Each state the component ships with, in the order to show them. */
  readonly states: readonly {
    readonly title: string;
    /** What this state shows, when the title alone does not say it. */
    readonly note?: string;
    /** The state's HTML, as a page author would write it. */
    readonly markup: string;
    /**
     * Shown in a frame of its own: a state that takes over the page it is in (a modal open at load makes everything
     * outside it inert) is confined to its frame, so the rest of the preview page stays usable.
     */
    readonly framed?: boolean;
    /**
     * Modules this state wires besides the page's own (renderer, keyed lists, slots, styles), each by its specifier
     * and export: `{ from: '@vera-components/input/stepper', name: 'stepper' }`. Wiring is page-wide, so such a state
     * is always shown in a frame of its own, the modules wired there before its components load.
     */
    readonly wires?: readonly { readonly from: string; readonly name: string }[];
  }[];
  /** Parts reached only by interaction: the part's name and what to do to see it. */
  readonly interactive?: readonly { readonly part: string; readonly how: string }[];
};
