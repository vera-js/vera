import { ElementsData, Route, RouteEventHandler, RouterSettings } from './types.js';

import { getMatch } from './utils.js';

/**
 * State
 */
export const routers = new WeakMap<HTMLElement, Set<Route>>();
/**
 *  Set with WeakRefs is an iterable fake WeakSet
 */
export const elements = new Set<WeakRef<HTMLElement>>();
export const elementsData = new WeakMap<HTMLElement, ElementsData>();
export const handlers = new WeakMap<HTMLElement | Document, Map<string, Set<RouteEventHandler>>>();
export const state = { currentPath: '' };

export const routerSettings: RouterSettings = {
  match: getMatch,
  pushHash: true,
};

/**
 * `map.get(key)`, creating the entry when it is missing.
 *
 * This replaced `get` from `@verajs/shared-utils`, whose chaining shape (`get(map).get(k, d).value`)
 * also carries Array support, an `instanceof` helper and a throwing fallback — none of which the
 * router reaches, and all of which its standalone bundle inlined.
 */
export const getOrCreate = <K, V>(map: { get(k: K): V | undefined; set(k: K, v: V): unknown }, key: K, make: () => V): V => {
  let value = map.get(key);
  if (value === undefined) map.set(key, (value = make()));
  return value;
};
