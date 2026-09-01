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
    const path = url.pathname + url.search + url.hash;
    /**
     * **A click has nobody to reject to.**
     *
     * `navigate()` rejects when a guard or a component throws, which is right for a caller that
     * awaits it. A link click is not that caller: this handler is `async`, so a rejection became an
     * **unhandled promise rejection** carrying the component's own message and nothing else — not
     * the path, not which router, not that this framework was involved. The page kept the previous
     * view, correctly, and said nothing about why the link did nothing.
     *
     * Reported as a DOM event as well as a console line, for the reason `@verajs/autoloader` does
     * the same with `vera:autoload-error`: a route that fails to render is something an app may want
     * to render *around* — a toast, a retry, a report to an error tracker — and an unhandled
     * rejection cannot be caught at the point it matters.
     */
    try {
      await navigate(path, 'navigate', element);
    } catch (error) {
      element.dispatchEvent(
        new CustomEvent('vera:route-error', {
          bubbles: true,
          composed: true,
          detail: { path, error, element },
        })
      );
      console.error(`[vera] router: navigating to ${path} threw, so the view was left as it was:`, error);
    }
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
 * and a `*wildcard` **costs** — which is what makes a catch-all `/*rest` sit last no matter where it
 * was declared. Longer patterns out-score shorter ones by summing. React Router ranks the same way
 * and for the same reason: `/users/new` should beat `/users/:id` without the author having to
 * remember which line it went on.
 *
 * The wildcard is negative rather than merely small, because the root route has **no segments at
 * all**: `/` scored 0 and `/*rest` scored 1, so a catch-all outranked the home page and every app
 * with a 404 route served the 404 at `/`. Nothing else moves — a wildcard only ever competes with
 * routes that also match, and against those it must always lose.
 */
const specificity = (pattern: string) =>
  pattern.split('/').reduce((total, segment) => {
    if (!segment) return total;
    if (segment[0] === '*') return total - 2;
    if (segment[0] === ':') return total + (segment.endsWith('?') ? 3 : 4);
    return total + 10;
  }, 0);

/**
 * A child's path, joined to its parent's.
 *
 * Both spellings work: `'/profile'` and `'profile'` under `/settings` are both `/settings/profile`.
 * They were concatenated verbatim, so the relative form — which is how Vue Router and React Router
 * are both written, and the first thing anyone tries — silently produced `/settingsprofile`: a
 * route that matches nothing anyone would navigate to, registered without complaint, so the
 * catch-all answered instead.
 *
 * An **empty** child path is the index route (`children: [{ path: '' }]`) and means the parent's own
 * URL exactly, so it gains nothing. A `path` function is resolved per navigation and is left alone.
 *
 * A **top-level** route is joined the same way, against the empty parent — which is the whole point,
 * and which an earlier `!parentRoute` short-circuit here excluded. `path: 'about'` at the root
 * registered the pattern `about`, with no leading slash, so it could not match the pathname
 * `/about`, nor could any of its children match anything: a whole subtree registered without
 * complaint and answered by the catch-all. `resolve('about')` returned `about` too, which is a
 * relative URL and navigates somewhere else entirely.
 */
const join = (parentRoute: string, path: string) =>
  !path || path[0] === '/' ? parentRoute + path : `${parentRoute}/${path}`;

/** Keeps the router's routes ordered most-specific first, which is the order `getRoute` walks. */
const insertRoute = (element: HTMLElement, route: Route) => {
  const routeList = getOrCreate(routers, element, () => [] as Route[]);
  let at = routeList.length;
  while (at > 0 && routeList[at - 1].score! < route.score!) at--;
  routeList.splice(at, 0, route);
};

/**
 * **A key a route does not have is a mistake, and `meta` is where anything else belongs.**
 *
 * The set is closed on purpose, so this is safe to be strict about. The cases it catches are the
 * spellings the neighbouring routers use — Vue Router's `components`, React Router's `element` and
 * `loader` — each of which registers a route that matches its path and then renders nothing, which
 * reads as a broken router rather than a wrong key. A typed caller is told by the compiler; the
 * buildless caller this framework treats as first-class was told by nobody.
 *
 * `__DEV__`-only, so a production bundle carries neither the list nor the text.
 */
const ROUTE_KEYS = ['path', 'name', 'title', 'meta', 'beforeEnter', 'alias', 'children', 'component', 'action', 'redirect', 'view'];

export const addRoutes = (
  element: HTMLElement,
  routes: RouteOptions[],
  parentRoute: string = '',
  parent?: Route,
  /**
   * Set while registering the copy of a subtree that hangs under an alias. Those entries match and
   * render exactly like the originals, but they are **not** where a name points: `names` maps a name
   * to the one URL `resolve` should build, and re-registering a child under every alias would leave
   * it pointing at whichever alias was declared last — plus a duplicate-name warning for a
   * duplication the author never wrote.
   */
  aliased: boolean = false
) => {
  for (let i = 0; i < routes.length; i++) {
    /** Not on the aliased pass — the same route objects are re-registered per alias, and one typo is one warning. */
    if (__DEV__ && !aliased)
      for (const key of Object.keys(routes[i]))
        if (!ROUTE_KEYS.includes(key))
          console.warn(
            `[vera] router: \`${key}\` is not a route option, so it was ignored on ` +
              `"${String(routes[i].path)}". The options are ${ROUTE_KEYS.join(', ')} — anything else ` +
              `belongs in \`meta\`, which every guard and action reads off the snapshot.`
          );
    const { path } = routes[i];
    const completePath = typeof path === 'function' ? path : join(parentRoute, path);

    const route: Route = { ...routes[i], parent };
    if (!aliased && route.name !== undefined && typeof completePath === 'string') {
      if (__DEV__ && names.has(route.name) && names.get(route.name) !== completePath)
        console.warn(
          `[vera] two routes are named "${route.name}" — "${names.get(route.name)}" and ` +
            `"${completePath}". The last one registered is the one \`resolve\` will build.`
        );
      names.set(route.name, completePath);
    }
    if (typeof path !== 'function') {
      /** Narrowed from `path`, which TypeScript cannot carry across to the value derived from it. */
      const complete = completePath as string;
      route.matchFunction = routerSettings.match(complete);
      route.score = specificity(complete);

      /**
       * An alias is the same route reachable at another URL, and only the URL differs — the same
       * component, guards, name and `meta`. It gets its own entry because matching is per-pattern;
       * everything else is shared with the route it aliases.
       */
      const { alias } = routes[i];
      const aliasRoutes: Route[] = [];
      if (alias !== undefined)
        for (const aliasPath of Array.isArray(alias) ? alias : [alias]) {
          const aliasComplete = join(parentRoute, aliasPath);
          aliasRoutes.push({
            ...route,
            path: aliasComplete,
            matchFunction: routerSettings.match(aliasComplete),
            score: specificity(aliasComplete),
          });
        }

      /**
       * Children are registered against this exact object, so a matched child can walk back up to
       * render its ancestors — see `routeChange`. They must therefore be added *after* the parent
       * is fully built rather than before.
       *
       * They are registered under **every alias as well**, each against that alias's own object so
       * the ancestor walk finds the URL that was actually matched. An alias whose children 404 is
       * the trap this avoids: `/people` worked, `/people/new` did not, and nothing said why. Vue
       * Router carries children through an alias for the same reason.
       */
      const { children } = routes[i];
      if (children) {
        addRoutes(element, children, complete, route, aliased);
        for (let a = 0; a < aliasRoutes.length; a++)
          addRoutes(element, children, aliasRoutes[a].path as string, aliasRoutes[a], true);
      }

      for (let a = 0; a < aliasRoutes.length; a++) insertRoute(element, aliasRoutes[a]);
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
