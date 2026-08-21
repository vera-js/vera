import { RouteEvent, RouteEventHandler, RouteOptions, RouterMethods, RouterOptions } from './types.js';
import { on, off } from './events.js';
import { elements, elementsData, routerSettings } from './state.js';
import { attachWindowListeners, navigate } from './services.js';
import { addRoutes, deleteRouter } from './methods.js';

/**
 * Inits a router instance and connects it to the lifecycle of an element
 *
 * @param element Element router is being connected to
 * @param routerOptions Initialization options for the router
 * @return Methods used to interacte with the router
 */
export const initRouter = (
  element: HTMLElement,
  routerOptions: RouterOptions
): RouterMethods => {
  const { view, focusView = true, handleInitial = true } = routerOptions;
  // TODO Set up minified error handling
  if (!element || !view) throw new Error('Set an element and view');

  /** Deferred to first init so importing the router stays side-effect-free (and Node-safe). */
  attachWindowListeners();

  const elementWeakRef = new WeakRef(element);
  if (!elementsData.has(element)) {
    elementsData.set(element, { view, focusView, weakRef: elementWeakRef });
    elements.add(elementWeakRef);
  }

  /**
   * Only options the caller actually passed touch the shared settings. Destructuring defaults
   * wrote `pushHash: true` on every init, so the last router silently clobbered the others'.
   */
  if (routerOptions.pushHash !== undefined) routerSettings.pushHash = routerOptions.pushHash;
  if (routerOptions.hashChangeFunction !== undefined)
    routerSettings.hashChangeFunction = routerOptions.hashChangeFunction;

  if (handleInitial)
    requestAnimationFrame(() => {
      /**
       * `navigate` routes every connected router and dedupes on `currentPath`, so with several
       * routers the first rAF handles the whole page and the rest return immediately. No history
       * entry is written for `'init'` — the landing entry already exists.
       */
      navigate(window.location.pathname + window.location.hash, 'init');
    });

  return {
    addRoutes: (routes: RouteOptions[]) => addRoutes(element, routes),
    deleteRouter: () => deleteRouter(element),
    on: (event: RouteEvent, handler: RouteEventHandler) => on(element, event, handler),
    off: (event: RouteEvent, handler: RouteEventHandler) => off(element, event, handler),
  };
};
