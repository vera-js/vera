/** A component element, carrying what `init` and the hooks attach to it. */
export interface ComponentElement extends HTMLElement {
  /**
   * The element's hooks, dense and priority-sorted. Attached to the element so they are collected
   * with it — the store holds them only weakly.
   */
  _hooks?: Hooks;
  /** Priorities parallel to `_hooks`, which is kept dense rather than indexed by priority. */
  _hookPriorities?: number[];
  /**
   * How many times this element has been `init()`ed. A hook captures the value it was created
   * under and does nothing when it no longer matches — see `createHook`.
   */
  _gen?: number;
  /** Effect cleanups awaiting removal, which runs them (see `init`). Read by the renderer's adapters. */
  _cleanups?: Set<HookCleanup>;
  /** Set once removal has swept `_cleanups`, so a cleanup registered after it runs at once. */
  _removed?: boolean;
  /** Wrapped at `customElements.define` time to run `_cleanups`; an author's own is chained first. */
  disconnectedCallback?: () => void;
  /**
   * The root this element renders into, kept because `element.shadowRoot` is **null for a closed
   * shadow root** — that is what closed means, and it applies to the framework too. Read across
   * package boundaries by the `'render'` insert and by `@verajs/styles`, so it is a cross-boundary
   * contract and must never be mangled.
   */
  _root?: ShadowRoot;
  /**
   * What a parent's property bindings delivered before this element could receive them, recorded by
   * `@verajs/renderer` (template parts and `spread`) and drained by `init()` into reactive accessors
   * (`adoptProps`). A cross-BUNDLE contract: the recorders live in separately built bundles on a CDN
   * page, so the `_$…$` sigil keeps the name stable under mangling. Absent when nothing was bound.
   */
  _$props$?: Record<string, unknown>;
  /**
   * The live half of the same contract: installed once per element, and a property delivered AFTER the
   * drain — a hydrated child whose parent commits late, a spread bag growing a key — is handed here.
   */
  _$adopt$?: (key: string, value: unknown) => void;
  /**
   * The delivered values, RAW: the target of the store behind the accessors (the store writes raw values into it).
   * What a parent's `!name` compares against — reading through the accessor costs a store read on every render and
   * hands an object back as its proxy, which never equals the object bound. Created with the store, so a component
   * that received nothing has none.
   */
  _$raw$?: Record<string, unknown>;
}

/** What `createHook` registers: the callback, its priority, and optionally its owner. */
export type Hook = {
  /** Run on the first pass and again whenever a store it read changes. */
  callback: HookCallback | null;
  /** The owner, instead of the element being set up — an element, or any object owning a value. */
  element?: ComponentElement;
  /** Lower runs earlier; `0` is legal and the earliest. */
  priority: number | null;
};

/** Returned from an effect to undo whatever it set up; run before its next run. */
export type HookCleanup = () => void;

/** A hook's callback: handed the signal that woke it, and `init` on the first pass. */
export type HookCallback = <V>(signal?: Signal<V>, init?: boolean) => void | HookCleanup;

/** An element's hooks, dense and priority-sorted — `_hookPriorities` runs parallel to it. */
export type Hooks = Set<HookCallback>[];

/** The template that is passed to the renderer is a useRender hook and the render helper function */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RenderTemplate = <V>(signal?: Signal<V>) => any;

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

/** The change that woke a hook: which property, and its value after and before. */
export type Signal<V> = {
  prop?: string;
  value?: V;
  prevValue?: V;
};

/**
 * How a render pass or `useEffect` run is deferred: handed the pass, and the element it belongs to when
 * there is one (so a scheduler can use that element's own window), it decides WHEN to run it — never
 * whether. The default is the element window's next animation frame; `microtask` is exported.
 */
export type RenderScheduler = (run: () => void, element?: Element) => void;

/** A reactive store over `T`. */
export type Store<T extends object = object> = T;
