import { Route, RouteOptions } from './types.js';
import { routerSettings } from './state.js';
import { navigate } from './services.js';
import { elements, elementsData, getOrCreate, handlers, names, routers } from './state.js';

/**
 * Adds a listener to an element that queries for valid links and changes the route if appropriate.
 * Attached **once per element** — `addRoutes` is a public method meant to be called repeatedly,
 * and every call used to stack another listener. The handler is kept on `elementsData` so
 * `deleteRouter` can remove it.
 *
 * Known limitation: links inside a child component's own shadow root are invisible here (event
 * retargeting) — routed links belong in the router's template.
 *
 * @param element Element to query for valid links on clicks
 */
const addLinkListener = (element: HTMLElement) => {
  const data = elementsData.get(element);
  if (!data || data.clickHandler) return;

  data.clickHandler = async (e: Event) => {
    const link = (e.target as Element)?.closest('a');
    if (!link) return;

    const href = link.getAttribute('href');
    if (!link.hasAttribute('route') || !href) return;

    /**
     * Resolved against where the page is, so `href="edit"`, `href="./edit"` and `href="../"` all
     * work the way they do in plain HTML — React Router's relative links, without a component to
     * compute them. An absolute path is unaffected.
     *
     * It also settles a link pointing off-site: a `route` attribute on a cross-origin `href` used
     * to be hijacked and handed to the router as a path, which matched nothing and dead-ended the
     * click. The browser owns those.
     */
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return;

    /**
     * The browser's behavior wins for anything that is not a plain left-click on an in-page
     * link: modified clicks open tabs/windows, `target` aims elsewhere, `download` saves.
     * Hijacking those is the classic SPA-router etiquette bug.
     */
    const click = e as MouseEvent;
    if (click.defaultPrevented || click.button !== 0) return;
    if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return;
    if (link.target || link.hasAttribute('download')) return;

    e.preventDefault();
    await navigate(url.pathname + url.search + url.hash, 'navigate', element);
  };

  (element.shadowRoot ?? element).addEventListener('click', data.clickHandler);
};

/**
 * Adds routes to a router instance.
 *
 * @param element
 * @param routes
 * @param parentRoute
 */
/**
 * How specific a pattern is, so the most specific route wins rather than the first registered.
 *
 * A static segment is worth far more than a `:param`, a required param more than an optional one,
 * and a `*wildcard` almost nothing — which is what makes a catch-all `/*rest` sit last no matter
 * where it was declared. Longer patterns out-score shorter ones by summing. React Router ranks the
 * same way and for the same reason: `/users/new` should beat `/users/:id` without the author
 * having to remember which line it went on.
 */
const specificity = (pattern: string) =>
  pattern.split('/').reduce((total, segment) => {
    if (!segment) return total;
    if (segment[0] === '*') return total + 1;
    if (segment[0] === ':') return total + (segment.endsWith('?') ? 3 : 4);
    return total + 10;
  }, 0);

/** Keeps the router's routes ordered most-specific first, which is the order `getRoute` walks. */
const insertRoute = (element: HTMLElement, route: Route) => {
  const routeList = getOrCreate(routers, element, () => [] as Route[]);
  let at = routeList.length;
  while (at > 0 && routeList[at - 1].score! < route.score!) at--;
  routeList.splice(at, 0, route);
};

export const addRoutes = (
  element: HTMLElement,
  routes: RouteOptions[],
  parentRoute: string = '',
  parent?: Route
) => {
  for (let i = 0; i < routes.length; i++) {
    const { path } = routes[i];
    const completePath = parentRoute + path;

    const route: Route = { ...routes[i], parent };
    if (route.name !== undefined && typeof completePath === 'string') {
      if (__DEV__ && names.has(route.name) && names.get(route.name) !== completePath)
        console.warn(
          `[vera] two routes are named "${route.name}" — "${names.get(route.name)}" and ` +
            `"${completePath}". The last one registered is the one \`resolve\` will build.`
        );
      names.set(route.name, completePath);
    }
    if (typeof path !== 'function') {
      route.matchFunction = routerSettings.match(completePath);
      route.score = specificity(completePath);
      /**
       * Children are registered against this exact object, so a matched child can walk back up to
       * render its ancestors — see `routeChange`. They must therefore be added *after* the parent
       * is fully built rather than before.
       */
      const { children } = routes[i];
      if (children) addRoutes(element, children, completePath, route);

      /**
       * An alias is the same route reachable at another URL, and only the URL differs — the same
       * component, guards, name and `meta`. It gets its own entry because matching is per-pattern;
       * everything else is shared with the route it aliases.
       */
      const { alias } = routes[i];
      if (alias !== undefined)
        for (const aliasPath of Array.isArray(alias) ? alias : [alias]) {
          const aliasComplete = parentRoute + aliasPath;
          insertRoute(element, {
            ...route,
            matchFunction: routerSettings.match(aliasComplete),
            score: specificity(aliasComplete),
          });
        }
    } else {
      /** A `path` function is resolved per navigation, so its specificity is not knowable here. */
      route.score = 0;
    }

    insertRoute(element, route);
  }

  if (!parentRoute) addLinkListener(element);
};

/**
 * Removes a named route from a router. The inverse of `addRoutes`, for routes that arrive with a
 * permission or a feature flag and have to leave again.
 *
 * Routes are flat here, so this removes the named route and its aliases — not its children, which
 * are named and removed in their own right.
 */
export const removeRoute = (element: HTMLElement, name: string) => {
  const routeList = routers.get(element);
  if (!routeList) return false;
  const before = routeList.length;
  for (let i = routeList.length - 1; i >= 0; i--) if (routeList[i].name === name) routeList.splice(i, 1);
  names.delete(name);
  return routeList.length < before;
};

/**
 * Deletes the router connected to an element: its routes, element data, event handlers, and the
 * link click listener.
 *
 * @param element The element that the router was initialized with
 */
export const deleteRouter = (element: HTMLElement) => {
  const data = elementsData.get(element);
  if (data?.clickHandler) (element.shadowRoot ?? element).removeEventListener('click', data.clickHandler);
  if (data?.weakRef) elements.delete(data.weakRef);
  routers.delete(element);
  elementsData.delete(element);
  handlers.delete(element);
};
