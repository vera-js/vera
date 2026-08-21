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
