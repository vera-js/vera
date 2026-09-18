export type { Autoloader } from '@verajs/shared-types';

/**
 * What caused a routing pass, carried on the snapshot so a handler can tell a user's click from
 * the browser's own history traversal.
 *
 * The distinction is load-bearing for scroll: only `popstate` arrives with a saved position to
 * restore, and only `init` runs with the fragment already in the URL but the routed content not
 * yet built — which is why the hash is applied explicitly there rather than left to the browser's
 * anchor scroll, which already fired against a page that did not have the target in it.
 */
export type RouteTrigger = 'init' | 'navigate' | 'replace' | 'popstate' | 'hashchange';

/**
 * The params a matched pattern produced. `string[]` is the wildcard's yield (`*rest` collects the
 * remaining segments); every named param is a `string`.
 *
 * Loose on purpose — every value is optional because the shape depends on which route matched.
 * A route declared with a literal path gets the exact shape instead, inferred by
 * {@link ParseRouteParams}, and that is what a component written against one route should use.
 */
export type RouteParams = Partial<Record<string, string | string[]>>;

/** Where to navigate: a path, or a named route and its params. */
export type RouteTarget = string | { name: string; params?: RouteParams };

/** Alias — same shape as {@link RouteParams}, kept for path-to-regexp-compatible naming. */
export type ParamData = RouteParams;

/**
 * The signature every route callback shares — `component`, `action`, `title`, `view`,
 * `beforeEnter`. `from` is absent on the first routing pass, since nothing was left.
 *
 * Returning `false` from a guard cancels the navigation; other callbacks' return values are used
 * per field (`title` and `view` consume theirs, `action` and `component` do not).
 */
export type RouteAction = (params: RouteParams, to: RouteSnapshot, from?: RouteSnapshot) => unknown;

/** A {@link RouteAction} whose params are read from the route's own pattern. */
export type TypedRouteAction<Path, Result = unknown> = (
  params: ParseRouteParams<Path>,
  to: RouteSnapshot,
  from?: RouteSnapshot
) => Result;

/** Which token produced a key: `*rest` yields a `string[]`, `:id` a `string`. */
export type ParsedPatternKeyType = 'wildcard' | 'param';

/** One token found in a pattern, in the order the matcher's capture groups will fill it. */
export type ParsedPatternKey = { name: string; type: ParsedPatternKeyType };

/**
 * A route pattern compiled once — its tokens in capture order, and the `RegExp` that finds them.
 *
 * Every field is optional because a pattern is built up in stages and a route whose `path` is a
 * function has nothing to compile until it is called.
 */
export type ParsedPattern = {
  keys?: ParsedPatternKey[];
  pattern?: string;
  regExp?: RegExp;
};

/**
 * Called with the fragment (`#` included) whenever one is applied, so an app can do its own
 * in-page scrolling or highlighting instead of the browser's.
 *
 * It runs on a real `hashchange` for user navigation, and is invoked DIRECTLY on `init`, where no
 * event fires because the fragment was already in the URL when the page loaded.
 */
export type HashChangeFunction = (path: string) => void;

/**
 * Replaces where the page scrolls to after routing. `saved` is the position stamped on the history
 * entry a back/forward traversal landed on, and is absent for every other trigger. The default,
 * with none of this set, is `saved` if there is one and the top of the page otherwise.
 */
export type ScrollBehaviorFunction = (to: RouteSnapshot, saved?: [number, number]) => void;

/**
 * The three points a router-wide handler can attach to, in the order they run.
 *
 * `before-leave` and `before-route` can each CANCEL the navigation by returning exactly `false`;
 * a handler may be async and is awaited. `after-route` is informational — the render has already
 * happened. Per-route guarding is {@link RouteOptions.beforeEnter}, which runs between
 * `before-route` and the route's own `action`.
 */
export type RouteEvent = 'before-leave' | 'before-route' | 'after-route';

/**
 * The settings shared by every router on the page, as opposed to the per-element
 * {@link RouterOptions}.
 *
 * There is one of these because there is one URL: several routers can render different views of
 * the same location, and matching, scrolling and fragment handling have to agree. `initRouter`
 * writes a field here only when that call actually supplied it — an unconditional write meant the
 * last router to initialise silently clobbered what the others had set.
 */
export type RouterSettings = {
  hashChangeFunction?: HashChangeFunction;
  scrollBehavior?: ScrollBehaviorFunction;
  match: <P extends ParamData>(routePattern: string) => MatchFunction<P>;
  pushHash?: boolean;
};

/**
 * Where the router is, handed to every guard, action and component, and readable afterwards as
 * `currentRoute`.
 *
 * It describes the DESTINATION of a routing pass; the same shape arrives as `from` on the next
 * pass. `query` and `hash` ride in the URL but take no part in pattern matching, which sees the
 * path alone — a hash-only change updates `hash` here without re-routing at all.
 */
export type RouteSnapshot = {
  path: string | (() => string);
  params?: RouteParams;
  /** Parsed query string — the query rides in the URL but never reaches pattern matching. */
  query?: URLSearchParams;
  trigger?: RouteTrigger;
  /** Whatever the matched route declared as `meta`. */
  meta?: RouteMeta;
  /** The fragment, `#` included, or `''`. Updated on a hash-only change without re-routing. */
  hash?: string;
};

/**
 * Arbitrary data attached to a route and handed to every guard, action and component on the
 * snapshot. This is where `requiresAuth`, a layout name, a breadcrumb label or an analytics id
 * belong: the router never reads it, so a guard can decide on the route's own terms instead of
 * re-parsing its path.
 */
export type RouteMeta = Record<string, unknown>;

/**
 * A route as the router holds it — the author's {@link RouteOptions} plus what registration
 * computed: its compiled matcher, its specificity, and its place in the tree.
 *
 * Nesting is recorded by a `parent` pointer rather than by keeping the children array, so a match
 * can walk up and render every ancestor level without re-searching the tree.
 */
export type Route = {
  matchFunction?: MatchFunction<ParamData>;
  /** How specific this route's complete pattern is — routes are matched most-specific first. */
  score?: number;
  /** The route this one was declared inside, so a match can render its ancestors. */
  parent?: Route;
} & RouteOptions;

/**
 * One route, as you declare it. The only required field is `path`; everything else is opt-in, and
 * a route with just a `path` and a `component` is the common case.
 *
 * Paths are RELATIVE TO THE PARENT inside `children`, so a subtree can be moved by editing one
 * line. Routes are matched most-specific-first by a score summed over the pattern rather than in
 * declaration order, so `/users/new` wins over `/users/:id` however they are written — and a
 * catch-all never outranks a real page.
 */
export type RouteOptions = {
  path: (() => string) | string;
  /**
   * A stable handle for this route, so links and redirects are built from `resolve(name, params)`
   * rather than by hand. Renaming the path then leaves every caller alone.
   */
  name?: string;
  title?: RouteAction | string;
  /** Arbitrary data for guards to read off the snapshot — see {@link RouteMeta}. */
  meta?: RouteMeta;
  /**
   * A guard for this route alone, run after the router's `before-route` handlers and before its
   * `action`. Return `false` to cancel. On a nested route the chain runs outermost first.
   */
  beforeEnter?: RouteAction;
  /** Other paths that reach this same route. Relative to the parent, exactly as `path` is. */
  alias?: string | string[];
  children?: RouteOptions[];
  /**
   * The chunk-warming half of a lazy route: `load: () => import('./heavy.js')`, resolved for
   * every matched level BEFORE any view transition wraps the renders — inside the wrap the page
   * is frozen on its old snapshots, so an import awaited there is a visible hang. Correct order
   * even unanimated: the old view stays interactive while the chunk arrives. A throw here
   * rejects `navigate()`. `component` still renders; `load` only front-runs the fetch.
   *
   * SECURITY: guards run FIRST — a route the guards refuse never has its `load` called, so a
   * refused visitor's chunk neither downloads nor executes through this seam. The standing
   * rule of every code-split app still applies (client chunks are public artifacts an
   * attacker can fetch directly), so authorization lives server-side and never in a chunk's
   * obscurity — but this router adds no pre-authorization execution of its own.
   */
  load?: (params: RouteParams) => unknown;
  component?: RouteAction;
  action?: RouteAction;
  /**
   * Send this route somewhere else. Resolves before anything renders and costs no history entry
   * for the abandoned path; chains are cut off after 10 hops. A function receives the matched
   * params and the destination snapshot.
   */
  redirect?: string | ((params: RouteParams, to: RouteSnapshot) => string);
  view?: RouteAction | string | HTMLElement | ShadowRoot;
};

/**
 * What a router needs no matter how it was created — where to render, and whether to move focus
 * after it does. Shared by the public {@link RouterOptions} and the internal
 * {@link ElementsData}.
 *
 * `focusView` defaults to TRUE and is an accessibility default, not a convenience: a client-side
 * navigation replaces the page's content without moving focus, so a keyboard or screen-reader
 * user is left pointing at a node that no longer exists. Focus moves to the new view's first
 * focusable element, or to the view itself with `tabindex="-1"` if it has none.
 */
export type BaseRouterOptions = {
  focusView?: boolean;
  view: HTMLElement | ShadowRoot | string;
};

/**
 * The router state held per element — internal, and the reason `initRouter` is idempotent.
 *
 * The element is kept as a `WeakRef` so a router whose host is removed from the document does not
 * pin it in memory; `clickHandler` is retained only so `deleteRouter` can detach the exact
 * listener it added, and so a second `addRoutes` cannot stack a duplicate.
 */
export interface ElementsData extends BaseRouterOptions {
  currentRoute?: RouteSnapshot;
  weakRef: WeakRef<HTMLElement>;
  /** The link click handler, kept so `deleteRouter` can remove it and re-`addRoutes` cannot stack another. */
  clickHandler?: (e: Event) => void;
}

/**
 * What `initRouter(element, options)` accepts. `view` is required; everything else has a default.
 *
 * `handleInitial` (default true) routes the URL the page loaded with. Turn it off when something
 * else must run first — hydration of server-rendered markup, or an auth check — and drive the
 * first pass yourself. The remaining fields set the page-wide {@link RouterSettings}, and are
 * applied only when this call supplies them.
 */
export interface RouterOptions extends BaseRouterOptions {
  handleInitial?: boolean;
  hashChangeFunction?: HashChangeFunction;
  pushHash?: boolean;
  scrollBehavior?: ScrollBehaviorFunction;
}

/**
 * A route whose callbacks are typed from its own `path` literal.
 *
 * `children` keep the loose {@link RouteOptions} shape: threading the parent's pattern into them
 * needs a second inferred type parameter, and adding one collapses inference for the whole array —
 * every route, nested or not, loses its params. Typed at the level people write most, loose one
 * level down, beats typed nowhere. A child callback can still annotate its own params.
 */
export type TypedRouteOptions<Path> = Omit<
  RouteOptions,
  'path' | 'component' | 'action' | 'beforeEnter' | 'title' | 'view' | 'redirect'
> & {
  /**
   * Bare, not `Path | (() => string)` — a union here stops TypeScript recovering the literal from
   * it, and every route in the array loses its params. A `path` function is admitted by the
   * constraint on `Paths` instead, and reads back as the loose record.
   */
  path: Path;
  component?: TypedRouteAction<Path>;
  action?: TypedRouteAction<Path>;
  beforeEnter?: TypedRouteAction<Path>;
  title?: string | TypedRouteAction<Path, string>;
  view?: HTMLElement | ShadowRoot | string | TypedRouteAction<Path, HTMLElement | ShadowRoot | string>;
  redirect?: string | ((params: ParseRouteParams<Path>, to: RouteSnapshot) => string);
};

/**
 * Adds routes, inferring each one's params from its own `path`.
 *
 * The parameter is a mapped type over a tuple of path literals rather than a plain array, which is
 * what lets TypeScript run inference backwards: it recovers `Paths` from the `path` of each element
 * and then types that element's callbacks against it. A plain `RouteOptions[]` cannot do this —
 * the array's element type contextually types every callback the same way, so the literal is lost
 * before the callback is checked.
 */
export type AddRoutes = <const Paths extends readonly (string | (() => string))[]>(routes: {
  [K in keyof Paths]: TypedRouteOptions<Paths[K]>;
}) => void;

/**
 * What `initRouter` hands back — the whole per-router API.
 *
 * `currentRoute` is a live getter rather than a value, so reading it always gives where the router
 * is now; it is `undefined` until the first routing pass completes. `deleteRouter` detaches the
 * link handler and drops the element's state, which is what makes re-initialising the same element
 * safe.
 */
export type RouterMethods = {
  addRoutes: AddRoutes;
  /** Removes a named route and its aliases. Returns whether anything was removed. */
  removeRoute: (name: string) => boolean;
  /** Where this router is now — `undefined` until it has routed once. */
  readonly currentRoute: RouteSnapshot | undefined;
  deleteRouter: () => void;
  on: (event: RouteEvent, handler: RouteEventHandler) => void;
  off: (event: RouteEvent, handler: RouteEventHandler) => void;
};

/**
 * The params a pattern produces, read off the pattern **as a type**.
 *
 * `ParseRouteParams<'/users/:id'>` is `{ id: string }`, so a component written against that route
 * gets `params.id` typed and `params.nope` rejected — without a code generation step, a schema, or
 * an annotation at the call site. `:name?` is optional, `*name` is the `string[]` the wildcard
 * actually yields, and everything else contributes nothing.
 *
 * A non-literal `Path` — the `string` a `path` function is typed as — falls back to the loose
 * record. That is the first branch on purpose: without it, `string` matches none of the patterns
 * below and lands on `object`, which has no properties at all, and a dynamic route would reject
 * every param access rather than allowing any.
 *
 * With thanks to https://type-level-typescript.com, where this technique is explained.
 */
export type ParseRouteParams<Path> = Path extends string
  ? string extends Path
    ? RouteParams
    : Path extends `${infer Head}/${infer Rest}`
      ? ParseRouteParams<Head> & ParseRouteParams<Rest>
      : ParseRouteSegment<Path>
  : /** A `path` function — nothing to read, so the loose record. */ RouteParams;

/**
 * One segment's params. A token does not have to be the whole segment: the matcher's `:([^/:|]+)`
 * finds it anywhere, so `/fellow/john:id` is a real pattern that matches `/fellow/johnXYZ`, and a
 * type that only understood segment-initial tokens would silently give that route no params at all.
 */
type ParseRouteSegment<Segment extends string> = Segment extends `${string}*${infer Wildcard}`
  ? { [K in Wildcard]: string[] }
  : Segment extends `${string}:${infer Names}`
    ? ParseRouteNames<Names>
    : object;

/** A segment may carry more than one token — `:a:b` — so the tail is parsed the same way. */
type ParseRouteNames<Names extends string> = Names extends `${infer Name}:${infer Rest}`
  ? ParseRouteName<Name> & ParseRouteNames<Rest>
  : ParseRouteName<Names>;

/** A trailing `?` makes the param optional, exactly as it does at runtime. */
type ParseRouteName<Name extends string> = Name extends `${infer Base}?`
  ? { [K in Base]?: string }
  : { [K in Name]: string };

/**
 * A handler registered with `on(event, handler)`. Returning exactly `false` cancels the
 * navigation on the two `before-` events; an async handler is awaited before the router proceeds,
 * so a guard may check the network.
 */
export type RouteEventHandler = (to: RouteSnapshot, from?: RouteSnapshot) => unknown | Promise<unknown>;

/**
 * A successful match: the path that matched, and the params read out of it.
 *
 * `path` is the portion the pattern consumed, which is not always the whole input — a parent route
 * in a nested tree matches a prefix and leaves the rest to its children.
 */
export type MatchResult<P extends ParamData> = {
  path: string;
  params: P;
};
/**
 * The result of trying one pattern: `false` for no match, distinguishable from a match that
 * produced no params (which is a `MatchResult` with an empty `params`).
 */
export type Match<P extends ParamData> = false | MatchResult<P>;
/**
 * A pattern compiled into a test. `RouterSettings.match` is the factory that builds these, and
 * replacing it is how a different pattern syntax is swapped in for the whole page.
 */
export type MatchFunction<P extends ParamData> = (path: string) => Match<P>;
