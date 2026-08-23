import { inserts } from '@verajs/inserts';
import { MatchFunction, ParamData, RouteTrigger } from './types.js';

import { elements, elementsData, routers, routerSettings, state } from './state.js';
import { emitEvent, focusView, removeHashFragment } from './utils.js';
import { stripTrailingSlash } from '@verajs/shared-utils';
import { Renderer } from '@verajs/shared-types';

/**
 * Aliases
 */
export const ariaCurrent = 'aria-current';
export const page = 'page';

/**
 * Allows user to set a match function other than the default (intended to connect to path-to-regexp)
 *
 * @param matchFunction Match function to use when analyzing routes
 */
export const setMatchFunction = (matchFunction: <P extends ParamData>(routePattern: string) => MatchFunction<P>) => {
  routerSettings.match = matchFunction;
};

/**
 * Writes a history entry **only for user navigation**. `popstate` means the browser already moved
 * through existing entries — pushing there duplicated the current entry and destroyed the forward
 * stack (Forward died, Back needed two presses). `init` means the entry for the landing URL
 * already exists. Both were confirmed in jsdom before this guard existed. `replace` swaps the
 * current entry — redirects should not leave the abandoned path in history.
 */
const updateHistory = (path: string, trigger: RouteTrigger) => {
  if (trigger === 'navigate') {
    /**
     * Stamp the scroll position onto the entry being **left**, so traversing back to it can
     * restore where the user was. The browser's own restoration can't do this — it fires before
     * the routed content exists — which is why `scrollRestoration` is set to `'manual'`.
     */
    window.history.replaceState({ scroll: [window.scrollX, window.scrollY] }, '', window.location.href);
    window.history.pushState(null, '', path);
  } else if (trigger === 'replace') window.history.replaceState(null, '', path);
};

/** Scroll position carried by the entry a `popstate` traversal landed on, applied after routing. */
let pendingScroll: [number, number] | undefined;

/**
 * A navigation is superseded the moment a newer one starts.
 *
 * Every `await` in a route change — a guard, an `action`, a `component` that fetches — is a point
 * where the user can click something else. Without this, the slower earlier navigation finishes
 * last and overwrites the newer one's rendered view, history entry and `currentPath`: click a slow
 * route, change your mind, and the app lands on the route you abandoned. Each pass takes a ticket
 * and stops at the next checkpoint once a newer one exists, so nothing it does is committed.
 */
let navigationId = 0;

/**
 * Applies the fragment of a full path+hash navigation, after the path's own history write.
 *
 * For user navigation under `pushHash`, `location.replace('#…')` is the trick: a same-document
 * fragment replace **swaps** the current entry rather than adding one — so the whole navigation
 * costs a single entry — while still delivering native anchor behavior (scroll and `:target`).
 * The `hashchange` event it fires is what invokes `hashChangeFunction`, via the window listener.
 *
 * On `init` the fragment is already in the URL but the browser's own anchor scroll fired before
 * the routed content existed — so scroll explicitly now that it does, and call the function
 * directly (no event will fire).
 */
const applyHash = (hash: string, trigger: RouteTrigger) => {
  if (routerSettings.pushHash) {
    if (trigger !== 'init' && window.location.hash !== hash) {
      window.location.replace(hash);
      return;
    }
    document.getElementById(hash.slice(1))?.scrollIntoView?.();
  }
  routerSettings.hashChangeFunction?.(hash);
};

/**
 * Attached lazily by the first `initRouter` rather than at import time. Import-time listeners made
 * `import '@verajs/router'` throw in Node (`window` is not defined) — un-importable under SSR —
 * and were an unshakeable module-scope side effect.
 */
let windowListenersAttached = false;
export const attachWindowListeners = () => {
  if (windowListenersAttached) return;
  windowListenersAttached = true;

  window.addEventListener('popstate', (e) => {
    pendingScroll = (e.state as { scroll?: [number, number] } | null)?.scroll;
    navigate(window.location.pathname, 'popstate');
  });

  window.addEventListener('hashchange', () => {
    hashChange(window.location.hash);
  });

  /** The router restores scroll itself, after content renders — see `updateHistory`. */
  if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
};

/**
 * Routes the whole page to a path: every connected router follows, since they share one URL.
 *
 * This is the single entry for all triggers — link clicks, `popstate`, initial load, and
 * programmatic navigation. Owning the loop here is what makes multi-router pages coherent: the
 * old shape had each router guard on `state.currentPath` individually, so whether siblings routed
 * depended on async timing, and a link click updated the URL while routing only its own router.
 * Routers run **sequentially** so event order is deterministic.
 *
 * Focus moves in the router that initiated the navigation (`origin`), or in every routed view on
 * `popstate` — back/forward is a route change too, and focus should follow it.
 *
 * @param path Destination path (may include a hash fragment)
 * @param trigger What caused the navigation
 * @param origin The router element that initiated it, when one did (link clicks)
 * @return true if the page routed (or the change was hash-only)
 */
export const navigate = async (
  path: string,
  trigger: RouteTrigger = 'navigate',
  origin?: HTMLElement,
  redirectDepth = 0
): Promise<boolean> => {
  if (path === state.currentPath) return true;
  const id = ++navigationId;

  const strippedHref = stripTrailingSlash(path);
  const [newPath, hashIndex] = removeHashFragment(strippedHref);
  const [oldPath] = removeHashFragment(state.currentPath);

  /**
   * The query rides along in the URL but never reaches pattern matching — `/users?page=2` must
   * match the `/users` route (it previously matched nothing, silently dead-ending the link).
   * The parsed query is handed to routes on the snapshot.
   */
  const queryIndex = newPath.indexOf('?');
  const matchPath = queryIndex === -1 ? newPath : newPath.slice(0, queryIndex);
  const query = new URLSearchParams(queryIndex === -1 ? '' : newPath.slice(queryIndex));

  /** If the path is the same but the hash is the source of the change */
  if ((hashIndex > -1 && newPath === oldPath) || hashIndex === 0) {
    hashChange(hashIndex > 0 ? strippedHref.substring(hashIndex) : strippedHref);
    /** The native hash assignment (under `pushHash`) already created the entry — record only. */
    state.currentPath = path;
    return true;
  }

  /**
   * One matching pass, whose results the routing pass below reuses. Matching twice meant every
   * route's `RegExp` ran twice per navigation, and a `path` **function** was called — and its
   * pattern recompiled — twice as well.
   *
   * Redirects resolve here, **before** any router renders or history is written — they are
   * URL-level, so the first matching route that declares one wins for the page, and the abandoned
   * path never costs an entry. A redirected `navigate` stays a push (the target is the real
   * destination); `popstate`/`init` become `replace`, rewriting the traversed or landing entry.
   */
  const matches: [HTMLElement, NonNullable<ReturnType<typeof getRoute>>][] = [];
  for (const elementWeakRef of elements) {
    const element = elementWeakRef.deref();
    if (!element?.isConnected) {
      elements.delete(elementWeakRef);
      continue;
    }
    const match = getRoute(element, matchPath);
    const redirect = match?.route.redirect;
    if (redirect) {
      if (redirectDepth >= 10) {
        console.error(`[vera] redirect loop at ${path}`);
        return false;
      }
      const target =
        typeof redirect === 'function'
          ? redirect(match.params ?? {}, { path: matchPath, params: match.params, query, trigger })
          : redirect;
      return navigate(target, trigger === 'navigate' ? 'navigate' : 'replace', origin, redirectDepth + 1);
    }
    if (match) matches.push([element, match]);
  }

  let routed = false;
  for (const [element, match] of matches) {
    const shouldFocusView = element === origin || trigger === 'popstate';
    if (await routeChange(element, matchPath, trigger, shouldFocusView, query, id, match)) routed = true;
    if (id !== navigationId) return false;
  }
  if (!routed) return false;

  /**
   * History first (hashless path, query kept), fragment second: `applyHash` needs the routed
   * content in the DOM to scroll to, and its `location.replace` swaps the entry just written, so
   * the whole navigation costs exactly one entry. Under `pushHash: false` the fragment never
   * reaches the URL — it is handed to `hashChangeFunction` alone.
   */
  updateHistory(newPath, trigger);
  if (hashIndex > 0) applyHash(strippedHref.substring(hashIndex), trigger);
  /** Fresh navigation lands at the top, like a page load; anchors manage their own scroll. */
  else if (trigger === 'navigate' || trigger === 'replace') window.scrollTo?.(0, 0);
  else if (trigger === 'popstate') {
    /** Back/forward restores the position stamped on the entry (top when it carries none). */
    const scroll = pendingScroll;
    pendingScroll = undefined;
    window.scrollTo?.(scroll?.[0] ?? 0, scroll?.[1] ?? 0);
  }

  state.currentPath = path;
  return true;
};

const getRoute = (element: HTMLElement, path: string) => {
  const routes = routers.get(element);
  if (!routes) return;

  for (const route of routes) {
    const matchFunction = route.matchFunction;
    const match = (typeof route.path === 'function' ? routerSettings.match(route.path()) : matchFunction)?.(path);

    if (match) {
      return { route, ...match };
    }
  }
  return;
};

/**
 * Routes a single router element to a path (no hash fragment, no history writes — `navigate`
 * owns both). Returns false when this router has no matching route or an event handler cancelled;
 * true once the route has been applied. `after-route` is emitted for cleanup but cannot cancel —
 * the navigation has already happened.
 */
const routeChange = async (
  element: HTMLElement,
  path: string,
  trigger: RouteTrigger,
  shouldFocusView: boolean,
  query: URLSearchParams | undefined,
  id: number,
  result: NonNullable<ReturnType<typeof getRoute>>
) => {
  const elementData = elementsData.get(element);
  // TODO Minified error use Error helper function
  if (!elementData) return false;

  const { params = {}, route } = result;

  const previousRoute = elementData.currentRoute;
  const currentRoute = { path, params, query, trigger };

  /** Allow route cancellation before leaving route */
  if ((await emitEvent(element, 'before-leave', currentRoute, previousRoute)) === false) return false;
  if (id !== navigationId) return false;

  /** Optional route specific view */
  const rawView = route.view ?? elementData.view;

  /** If the view is a function, get the result */
  const processedView = rawView instanceof Function ? rawView(params, currentRoute, previousRoute) : rawView;

  /**
   * Get the view on the page. Quoted so names that need quoting (and a `view` function's
   * URL-param-derived results) cannot break the selector.
   */
  const view =
    processedView instanceof HTMLElement
      ? processedView
      : ((element.shadowRoot ?? element).querySelector(
          `[view="${String(processedView).replace(/"/g, '\\"')}"]`
        ) as HTMLElement);

  // TODO Minified error use Error helper function
  if (!view) return false;

  /** Get the title */
  const title = route.title;

  /** Allow route cancellation before arriving at route */
  if ((await emitEvent(element, 'before-route', currentRoute, previousRoute)) === false) return false;
  if (id !== navigationId) return false;

  /** Execute action function */
  await route.action?.(params, currentRoute, previousRoute);
  if (id !== navigationId) return false;

  /** Route has changed so we updated currentRoute */
  elementData.currentRoute = currentRoute;

  /** Change title to either the title string or the result of the title function if it's a function */
  if (title)
    element.ownerDocument.title =
      typeof title === 'function' ? (title(params, currentRoute, previousRoute) as string) : title;

  /** Render component */
  const template = await route.component?.(params, currentRoute, previousRoute);
  /** The last checkpoint before anything is painted: a superseded pass renders nothing. */
  if (id !== navigationId) return false;
  inserts.get('render')?.forEach((callback) => {
    (callback as Renderer)?.(template, view);
  });

  /** Focus view if option is set */
  if (elementData.focusView && shouldFocusView) focusView(view);

  /** Update active link */
  updateActiveLink(element, path);

  /** Allow final cleanup — informational, never cancels (the route already changed) */
  await emitEvent(element, 'after-route', currentRoute, previousRoute);

  return true;
};

const updateActiveLink = (element: HTMLElement, path: string) => {
  (element.shadowRoot ?? element).querySelectorAll('[route]').forEach((_element) => {
    _element.classList.remove('active', 'active-within');
    _element.removeAttribute(ariaCurrent);
    if (_element.classList.length === 0) {
      _element.removeAttribute('class');
    }

    /**
     * Pathname only (a link may carry its own query or hash), stripped on both sides so
     * `href="/about/"` still matches the normalized path.
     */
    const href = stripTrailingSlash((_element.getAttribute('href') ?? '').split(/[?#]/)[0]);
    if (href === path) {
      _element.classList.add('active');
      _element.setAttribute(ariaCurrent, page);
    } else if (href && href !== '/' && path.startsWith(href) && path[href.length] === '/') {
      /**
       * An ancestor of the current path — `/users` while at `/users/5` — gets `active-within`
       * (segment-boundary prefix, so `/user` never lights up for `/users`). `aria-current="page"`
       * stays exact-only per the ARIA spec; style `.active-within` for section nav.
       */
      _element.classList.add('active-within');
    }
  });
};

/**
 * Hash-only navigation. The native assignment is correct here — a fragment change *should* add a
 * history entry — and the `hashchange` event it fires is what calls `hashChangeFunction` (via the
 * window listener re-entering with an equal hash). Calling the function directly as well would
 * double-invoke it, which is exactly what the old shape did.
 */
export const hashChange = (hash: string) => {
  if (routerSettings.pushHash && window.location.hash !== hash) {
    window.location.hash = hash;
    return true;
  }
  routerSettings.hashChangeFunction?.(hash);
  return true;
};
