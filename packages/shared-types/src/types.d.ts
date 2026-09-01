/** Autoload function to be run by autoloader each time a component with the "autoloader" attribute
 * is rerendered
 */
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



/** Proxy object shape that is used in signal */
export type ProxyObject<T extends object> = (T | { value: T }) & StoreProxyKeys;

/** Render function to be run by useRender each time the provided store(s) change */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Renderer = (template: any, container: HTMLElement | ShadowRoot, ...args: any[]) => any;

/** Proxy keys added to state for checking if the obj is already a signal and if it shouldn't be reactive */
export type StoreProxyKeys = {
  /** Severs every subscription for the store. Present on object stores (not `{value}` carriers). */
  _delete?: () => void;
  /** Used to determine if an object is proxied The proxy handler always return true to this prop if it has been run before */
  _isSignal: boolean;
  /** Used to disable reactivity on a state object */
  _ignore?: boolean;
  /** Size that can be accessed on Map or Set */
  size?: number | null;
};
