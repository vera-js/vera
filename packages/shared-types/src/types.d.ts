/** Autoload function to be run by autoloader each time a component with the "autoloader" attribute
 * is rerendered
 */
export type Autoloader = (element: HTMLElement) => void;

/** The result of a custom get function */
export interface GetResult<T> {
  get: <K>(key: K, defaultValue: GetValueType<T>) => GetResult<GetValueType<T>>;
  value: T;
}

/** Infers value of subfunctions for get function */
export type GetValueType<T> = T extends Array<infer U>
  ? U
  : T extends Map<unknown, infer V>
  ? V
  : T extends WeakMap<object, infer V>
  ? V
  : never;

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
