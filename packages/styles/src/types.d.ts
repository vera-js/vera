/** A constructed stylesheet paired with its source text — what core's `css` tag produces. */
export type CSSResultGroup = { styleSheet: CSSStyleSheet; cssText: string };

/** Any element that may carry `static styles` on its constructor. */
export type StyledElement = HTMLElement & { shadowRoot: ShadowRoot | null };
