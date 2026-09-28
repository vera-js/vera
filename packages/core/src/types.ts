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

/**
 * The object core's `html` tag produces. Structurally compatible with lit-html's `TemplateResult`
 * (`_$litType$` 1 is html), so a lit renderer consumes it directly.
 */
export type TemplateResult = {
  _$litType$: 1;
  strings: TemplateStringsArray;
  values: unknown[];
};

/** The change that woke a hook: which property, and its value after and before. */
export type Signal<V> = {
  prop?: string;
  value?: V;
  prevValue?: V;
};

/** A reactive store over `T`. */
export type Store<T extends object = object> = T;
