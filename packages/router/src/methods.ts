import { Route, RouteOptions } from './types.js';
import { routerSettings } from './state.js';
import { navigate } from './services.js';
import { get } from '@verajs/shared-utils';
import { elements, elementsData, handlers, routers } from './state.js';

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
     * The browser's behavior wins for anything that is not a plain left-click on an in-page
     * link: modified clicks open tabs/windows, `target` aims elsewhere, `download` saves.
     * Hijacking those is the classic SPA-router etiquette bug.
     */
    const click = e as MouseEvent;
    if (click.defaultPrevented || click.button !== 0) return;
    if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return;
    if (link.target || link.hasAttribute('download')) return;

    e.preventDefault();
    await navigate(href, 'navigate', element);
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
export const addRoutes = (element: HTMLElement, routes: RouteOptions[], parentRoute: string = '') => {
  for (let i = 0; i < routes.length; i++) {
    const { path } = routes[i];
    const completePath = parentRoute + path;

    let route: Route = { ...routes[i] };
    if (typeof path !== 'function') {
      const { children } = routes[i];
      if (children) {
        addRoutes(element, children, completePath);
      }
      const matchFunction = routerSettings.match(completePath);
      route = { ...route, matchFunction };
    }

    get(routers).get(element, new Set<Route>()).value.add(route);
  }

  if (!parentRoute) addLinkListener(element);
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
