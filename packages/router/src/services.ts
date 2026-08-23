import { inserts } from '@verajs/inserts';
import { MatchFunction, ParamData, Route, RouteParams, RouteTarget, RouteTrigger } from './types.js';

import { elements, elementsData, names, routers, routerSettings, state } from './state.js';
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
 * The history stack, by the names the other routers use. `go(-1)` and `back()` are the same call;
 * both are here because a component that already imports `navigate` should not have to reach for
 * `window.history` to undo it.
 */
export const go = (delta: number) => window.history.go(delta);
export const back = () => go(-1);
export const forward = () => go(1);

/**
 * Builds the path for a named route.
 *
 * ```js
 * navigate(resolve('user', { id: 5 }));      //  /users/5
 * link.href = resolve('user', { id: 5 });
 * ```
 *
 * A name is a handle on a URL, so renaming `/users/:id` to `/people/:id` leaves every caller alone
 * — which is the whole reason both Vue Router and React Router have this. Values are encoded, so a
 * param round-trips through the decoding that happens on the way back in. An optional param left
 * out drops its whole segment, slash included; a wildcard takes an array of segments.
 *
 * @param name The route's `name`
 * @param params Values for the pattern's `:params` and `*wildcards`
 * @return The path, or `''` if no route carries that name
 */
export const resolve = (name: string, params: RouteParams = {}) => {
  const pattern = names.get(name);
  if (pattern === undefined) {
    if (__DEV__) console.warn(`[vera] no route is named "${name}"`);
    return '';
  }
  return pattern.replace(/\/?[:*]([^/:|?]+)\??/g, (token, key: string) => {
    const value = params[key];
    /** An absent optional param takes its segment with it; an absent required one is left visible. */
    if (value === undefined) return token.endsWith('?') ? '' : token;
    return `/${(Array.isArray(value) ? value : [value]).map(encodeURIComponent).join('/')}`;
  });
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
    /**
     * The fragment has to travel with the path here, for two reasons that look unrelated and are
     * the same one.
     *
     * A fragment navigation fires `popstate` **as well as** `hashchange` — verified in Chromium,
     * Firefox and WebKit, and jsdom agrees. Routing to `location.pathname` alone therefore looked
     * like a move away from `/docs#install` to `/docs`, and every anchor click cost a second, full
     * route change: the component ran twice, guards re-ran under a `'popstate'` trigger, and since
     * `popstate` focuses every routed view, clicking an in-page link stole focus. Passing the
     * whole URL makes `navigate` recognise it as where the page already is, and it returns at once.
     *
     * The same line is what makes traversing back to `/docs#install` restore the fragment rather
     * than dropping it.
     */
    navigate(window.location.pathname + window.location.hash, 'popstate');
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
  target: RouteTarget,
  trigger: RouteTrigger = 'navigate',
  origin?: HTMLElement,
  redirectDepth = 0
): Promise<boolean> => {
  /** `navigate({ name, params })` is the same call through `resolve` — Vue Router's shape. */
  const path = typeof target === 'string' ? target : resolve(target.name, target.params);
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
  const hash = hashIndex > 0 ? strippedHref.substring(hashIndex) : hashIndex === 0 ? strippedHref : '';

  /** If the path is the same but the hash is the source of the change */
  if ((hashIndex > -1 && newPath === oldPath) || hashIndex === 0) {
    hashChange(hash);
    /** The native hash assignment (under `pushHash`) already created the entry — record only. */
    state.currentPath = path;
    /**
     * The route did not change, so nothing re-renders and no guard runs — the browser has already
     * moved the fragment and there is nothing left to cancel. What every router still owes its
     * components is an up-to-date snapshot and a way to hear about it, so each one's `currentRoute`
     * takes the new fragment and `after-route` fires with the `'hashchange'` trigger.
     */
    for (const elementWeakRef of elements) {
      const element = elementWeakRef.deref();
      const elementData = element && elementsData.get(element);
      const previousRoute = elementData?.currentRoute;
      if (!previousRoute) continue;
      elementData.currentRoute = { ...previousRoute, hash, trigger: 'hashchange' };
      emitEvent(element, 'after-route', elementData.currentRoute, previousRoute);
    }
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
    if (await routeChange(element, matchPath, trigger, shouldFocusView, query, hash, id, match)) routed = true;
    if (id !== navigationId) return false;
  }
  if (!routed) return false;

  /**
   * Recorded **before** the URL is touched, because touching it re-enters here.
   *
   * `applyHash`'s `location.replace('#…')` fires `popstate` synchronously, and the listener routes
   * to wherever the URL now points. With this assignment left until the end, that re-entry saw the
   * *old* `currentPath`, decided the page had moved, and ran the whole route a second time under a
   * `'popstate'` trigger — which also focuses every routed view, so an anchor click stole focus.
   * Setting it first makes the re-entry recognise where it already is and return at once.
   */
  state.currentPath = path;

  /**
   * History first (hashless path, query kept), fragment second: `applyHash` needs the routed
   * content in the DOM to scroll to, and its `location.replace` swaps the entry just written, so
   * the whole navigation costs exactly one entry. Under `pushHash: false` the fragment never
   * reaches the URL — it is handed to `hashChangeFunction` alone.
   */
  updateHistory(newPath, trigger);
  if (hashIndex > 0) applyHash(strippedHref.substring(hashIndex), trigger);
  else {
    /**
     * Back/forward restores the position stamped on the entry; a fresh navigation lands at the
     * top, like a page load. `scrollBehavior` replaces both — for a list that should keep its
     * offset, a view that scrolls its own container rather than the window, or smooth scrolling.
     */
    const saved = trigger === 'popstate' ? pendingScroll : undefined;
    pendingScroll = undefined;
    const behavior = routerSettings.scrollBehavior;
    if (behavior) behavior({ path: matchPath, query, trigger }, saved);
    else window.scrollTo?.(saved?.[0] ?? 0, saved?.[1] ?? 0);
  }

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
/**
 * Routes a single router element to a path (no hash fragment, no history writes — `navigate`
 * owns both). Returns false when this router has no matching route or an event handler cancelled;
 * true once the route has been applied. `after-route` is emitted for cleanup but cannot cancel —
 * the navigation has already happened.
 *
 * A **nested** route renders its ancestors too, outermost first, each into a view found inside the
 * one above it. That is what `children` means now: `/settings/profile` renders the `/settings`
 * component into the router's outlet, and the `/settings/profile` component into an outlet the
 * settings template itself rendered. Guards, `beforeEnter` and `action` run down the same chain, so
 * a parent can refuse before a child does any work.
 */
const routeChange = async (
  element: HTMLElement,
  path: string,
  trigger: RouteTrigger,
  shouldFocusView: boolean,
  query: URLSearchParams | undefined,
  hash: string,
  id: number,
  result: NonNullable<ReturnType<typeof getRoute>>
) => {
  /** No data means `deleteRouter` ran between the match and here; there is nothing to route. */
  const elementData = elementsData.get(element);
  if (!elementData) return false;

  const { params = {}, route } = result;

  /** Outermost first. A route with no `parent` is a chain of one, which is the ordinary case. */
  const chain: Route[] = [];
  for (let ancestor: Route | undefined = route; ancestor; ancestor = ancestor.parent) chain.unshift(ancestor);

  const previousRoute = elementData.currentRoute;
  const currentRoute = { path, params, query, trigger, meta: route.meta, hash };

  /** Allow route cancellation before leaving route */
  if ((await emitEvent(element, 'before-leave', currentRoute, previousRoute)) === false) return false;
  if (id !== navigationId) return false;

  /** Allow route cancellation before arriving at route */
  if ((await emitEvent(element, 'before-route', currentRoute, previousRoute)) === false) return false;
  if (id !== navigationId) return false;

  for (const link of chain) {
    /** A guard belonging to this route alone, and the outer ones get to refuse first. */
    if ((await link.beforeEnter?.(params, currentRoute, previousRoute)) === false) return false;
    if (id !== navigationId) return false;
  }

  /**
   * Each level renders into a view looked up **inside the level above it**, so a nested outlet may
   * carry the same `view` name as the one it sits in without the outer query claiming it first.
   */
  let searchRoot: HTMLElement | ShadowRoot = element.shadowRoot ?? element;
  let view!: HTMLElement;

  for (const link of chain) {
    /** Optional route specific view */
    const rawView = link.view ?? elementData.view;

    /** If the view is a function, get the result */
    const processedView = rawView instanceof Function ? rawView(params, currentRoute, previousRoute) : rawView;

    /**
     * Found by scanning `[view]` and comparing the attribute, rather than by building a selector
     * around the name.
     *
     * A `view` function's result can derive from URL params, so the name is attacker-influenced. It
     * used to be interpolated into `[view="…"]` with only `"` escaped, and escaping a quote is not
     * enough: `a\"` becomes `a\\"`, which CSS reads as a literal backslash and then a string
     * terminator, so the value escapes the selector it was quoted into. In practice a crafted URL
     * threw a `DOMException` out of `navigate` — an unhandled rejection that killed the navigation —
     * and a selector that parsed would have chosen an element the author never marked as an outlet.
     * Comparing strings has no grammar to escape into and costs 3 B.
     */
    const wanted = String(processedView);
    let levelView = processedView instanceof HTMLElement ? processedView : (null as unknown as HTMLElement);
    if (!levelView)
      for (const candidate of searchRoot.querySelectorAll('[view]'))
        if (candidate.getAttribute('view') === wanted) {
          levelView = candidate as HTMLElement;
          break;
        }

    if (!levelView) {
      if (__DEV__ && link.parent)
        console.warn(
          `[vera] the route "${link.path}" is nested, so its view is looked for inside the one its ` +
            `parent rendered into — and no [view="${String(processedView)}"] was found there. A ` +
            `parent's template has to render the outlet its children route into.`
        );
      return false;
    }

    /** Execute action function */
    await link.action?.(params, currentRoute, previousRoute);
    if (id !== navigationId) return false;

    const template = await link.component?.(params, currentRoute, previousRoute);
    /** The last checkpoint before anything is painted: a superseded pass renders nothing. */
    if (id !== navigationId) return false;
    inserts.get('render')?.forEach((callback) => {
      (callback as Renderer)?.(template, levelView);
    });

    /** The next level down looks inside what this one just rendered. */
    searchRoot = levelView;
    view = levelView;
  }

  /** Route has changed so we updated currentRoute */
  elementData.currentRoute = currentRoute;

  /** Change title to either the title string or the result of the title function if it's a function */
  const title = route.title;
  if (title)
    element.ownerDocument.title =
      typeof title === 'function' ? (title(params, currentRoute, previousRoute) as string) : title;

  /** Focus the innermost view if option is set */
  if (elementData.focusView && shouldFocusView) focusView(view);

  /** Update active link */
  updateActiveLink(element, path);

  /** Allow final cleanup — informational, never cancels (the route already changed) */
  await emitEvent(element, 'after-route', currentRoute, previousRoute);

  return true;
};

const updateActiveLink = (element: HTMLElement, path: string) => {
  (element.shadowRoot ?? element).querySelectorAll('[route]').forEach((link) => {
    /**
     * Pathname only (a link may carry its own query or hash), stripped on both sides so
     * `href="/about/"` still matches the normalized path.
     */
    const href = stripTrailingSlash((link.getAttribute('href') ?? '').split(/[?#]/)[0]);

    const exact = href === path;
    /**
     * An ancestor of the current path — `/users` while at `/users/5`. The segment-boundary test is
     * what keeps `/user` from lighting up for `/users`. `aria-current="page"` stays exact-only per
     * the ARIA spec; style `.active-within` for section nav.
     */
    const within = !exact && !!href && href !== '/' && path.startsWith(href) && path[href.length] === '/';

    /**
     * `toggle(token, force)` writes only when the answer changed, and `removeAttribute` on an
     * absent attribute is a no-op — so a nav bar of 40 links costs the two writes that matter
     * rather than 80. The clear-then-re-add shape this replaced rewrote `class` on every link on
     * every navigation, because `classList.remove` runs its update steps whether or not the token
     * was there.
     */
    const classes = link.classList;
    classes.toggle('active', exact);
    classes.toggle('active-within', within);
    if (exact) link.setAttribute(ariaCurrent, page);
    else link.removeAttribute(ariaCurrent);
    /** A link whose only classes were ours should not be left carrying `class=""`. */
    if (classes.length === 0) link.removeAttribute('class');
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
