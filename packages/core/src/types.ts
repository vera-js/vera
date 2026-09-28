/** A component element, carrying what `init` and the hooks attach to it. */
export interface ComponentElement extends HTMLElement {
  /**
   * The element's hooks. Attached to the element so they are collected with it — the store holds
   * them only weakly.
   */
  _hooks?: Set<HookCallback>;
  /**
   * The root this element renders into, kept because `element.shadowRoot` is **null for a closed
   * shadow root** — that is what closed means, and it applies to the framework too. Read across
   * package boundaries by the `'render'` insert and by `@verajs/styles`, so it is a cross-boundary
   * contract and must never be mangled.
   */
  _root?: ShadowRoot;
}

/** A hook's callback: handed the signal that woke it, and `init` on the first pass. */
export type HookCallback = <V>(signal?: Signal<V>, init?: boolean) => void;

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
