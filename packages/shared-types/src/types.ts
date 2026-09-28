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

/** Render function to be run by useRender each time the provided store(s) change */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Renderer = (template: any, container: HTMLElement | ShadowRoot, ...args: any[]) => any;

