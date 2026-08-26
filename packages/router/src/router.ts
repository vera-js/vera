import { AddRoutes, RouteEvent, RouteEventHandler, RouteOptions, RouterMethods, RouterOptions } from './types.js';
import { on, off } from './events.js';
import { elements, elementsData, routerSettings } from './state.js';
import { attachWindowListeners, navigate } from './services.js';
import { addRoutes, deleteRouter, removeRoute } from './methods.js';

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
  /**
   * Thrown rather than warned: without a view there is no outlet, so every navigation would return
   * false and the router would look inert with nothing to explain it.
   */
  if (!element || !view) throw new Error('Set an element and view');

  /**
   * **An option this router does not have is a mistake, and silence about it is the bug.**
   *
   * `routes` is the one that matters: `createRouter({ routes })` is how Vue Router is initialised
   * and it is the first thing anyone tries here. Ignored quietly, the router comes up with no routes
   * at all, every navigation matches nothing, and the page renders an empty outlet with no
   * diagnostic anywhere — the failure looks like a broken router rather than a misplaced option.
   * A TypeScript caller is told by the compiler; the buildless caller this framework treats as
   * first-class is told by nobody.
   *
   * `__DEV__`-only, so a production bundle carries neither the list nor the text.
   */
  if (__DEV__) {
    const known = ['view', 'focusView', 'handleInitial', 'hashChangeFunction', 'pushHash', 'scrollBehavior'];
    for (const option of Object.keys(routerOptions))
      if (!known.includes(option))
        console.warn(
          `[vera] router: \`${option}\` is not an initRouter option, so it was ignored.` +
            (option === 'routes'
              ? ' Routes are registered separately: `const { addRoutes } = initRouter(el, { view }); addRoutes(routes)`.'
              : ` The options are ${known.join(', ')}.`)
        );
  }

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
  if (routerOptions.scrollBehavior !== undefined) routerSettings.scrollBehavior = routerOptions.scrollBehavior;

  if (handleInitial)
    requestAnimationFrame(() => {
      /**
       * `navigate` routes every connected router and dedupes on `currentPath`, so with several
       * routers the first rAF handles the whole page and the rest return immediately. No history
       * entry is written for `'init'` — the landing entry already exists.
       *
       * **`search` is part of the URL the page was opened with.** Leaving it out meant a route
       * landed on directly — a deep link, a refresh, a URL someone shared — saw an empty `query` on
       * its snapshot, while *clicking a link* to the very same URL saw the real one, because link
       * handling passes `pathname + search + hash`. `?page=2`, `?q=…` and every filter in a
       * bookmarked URL were invisible on exactly the load that had them.
       */
      navigate(window.location.pathname + window.location.search + window.location.hash, 'init');
    });

  return {
    /**
     * The generic lives on the returned method, not on `addRoutes` itself — that internal one also
     * recurses for `children` with a parent pattern, and typed params are a public-surface concern.
     */
    addRoutes: ((routes: RouteOptions[]) => addRoutes(element, routes)) as AddRoutes,
    removeRoute: (name: string) => removeRoute(element, name),
    /**
     * Where this router is now, with the params and query already parsed. Reading
     * `location.pathname` gives you the string back but not the match, and the snapshot was
     * otherwise reachable only from inside a route callback.
     */
    get currentRoute() {
      return elementsData.get(element)?.currentRoute;
    },
    deleteRouter: () => deleteRouter(element),
    on: (event: RouteEvent, handler: RouteEventHandler) => on(element, event, handler),
    off: (event: RouteEvent, handler: RouteEventHandler) => off(element, event, handler),
  };
};
