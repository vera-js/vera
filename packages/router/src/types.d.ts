export { Autoloader } from '@verajs/shared-types';

export type RouteTrigger = 'init' | 'navigate' | 'replace' | 'popstate' | 'hashchange';

export type RouteParams = Partial<Record<string, string | string[]>>;

/** Where to navigate: a path, or a named route and its params. */
export type RouteTarget = string | { name: string; params?: RouteParams };

/** Alias — same shape as {@link RouteParams}, kept for path-to-regexp-compatible naming. */
export type ParamData = RouteParams;

export type RouteAction = (params: RouteParams, to: RouteSnapshot, from?: RouteSnapshot) => unknown;

/** A {@link RouteAction} whose params are read from the route's own pattern. */
export type TypedRouteAction<Path, Result = unknown> = (
  params: ParseRouteParams<Path>,
  to: RouteSnapshot,
  from?: RouteSnapshot
) => Result;

export type ParsedPatternKeyType = 'wildcard' | 'param';

export type ParsedPatternKey = { name: string; type: ParsedPatternKeyType };

export type ParsedPattern = {
  keys?: ParsedPatternKey[];
  pattern?: string;
  regExp?: RegExp;
};

export type HashChangeFunction = (path: string) => void;

/**
 * Replaces where the page scrolls to after routing. `saved` is the position stamped on the history
 * entry a back/forward traversal landed on, and is absent for every other trigger. The default,
 * with none of this set, is `saved` if there is one and the top of the page otherwise.
 */
export type ScrollBehaviorFunction = (to: RouteSnapshot, saved?: [number, number]) => void;

export type RouteEvent = 'before-leave' | 'before-route' | 'after-route';

export interface RouterSettings {
  hashChangeFunction?: HashChangeFunction;
  scrollBehavior?: ScrollBehaviorFunction;
  match: <P extends ParamData>(routePattern: string) => MatchFunction<P>;
  pushHash?: boolean;
}

export interface RouteSnapshot {
  path: string | (() => string);
  params?: RouteParams;
  /** Parsed query string — the query rides in the URL but never reaches pattern matching. */
  query?: URLSearchParams;
  trigger?: RouteTrigger;
  /** Whatever the matched route declared as `meta`. */
  meta?: RouteMeta;
  /** The fragment, `#` included, or `''`. Updated on a hash-only change without re-routing. */
  hash?: string;
}

/**
 * Arbitrary data attached to a route and handed to every guard, action and component on the
 * snapshot. This is where `requiresAuth`, a layout name, a breadcrumb label or an analytics id
 * belong: the router never reads it, so a guard can decide on the route's own terms instead of
 * re-parsing its path.
 */
export type RouteMeta = Record<string, unknown>;

export type Route = {
  matchFunction?: MatchFunction<ParamData>;
  /** How specific this route's complete pattern is — routes are matched most-specific first. */
  score?: number;
  /** The route this one was declared inside, so a match can render its ancestors. */
  parent?: Route;
} & RouteOptions;

export interface RouteOptions {
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
  component?: RouteAction;
  action?: RouteAction;
  /**
   * Send this route somewhere else. Resolves before anything renders and costs no history entry
   * for the abandoned path; chains are cut off after 10 hops. A function receives the matched
   * params and the destination snapshot.
   */
  redirect?: string | ((params: RouteParams, to: RouteSnapshot) => string);
  view?: RouteAction | string | HTMLElement | ShadowRoot;
}

export interface BaseRouterOptions {
  focusView?: boolean;
  view: HTMLElement | ShadowRoot | string;
}

export interface ElementsData extends BaseRouterOptions {
  currentRoute?: RouteSnapshot;
  weakRef: WeakRef<HTMLElement>;
  /** The link click handler, kept so `deleteRouter` can remove it and re-`addRoutes` cannot stack another. */
  clickHandler?: (e: Event) => void;
}

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

export interface RouterMethods {
  addRoutes: AddRoutes;
  /** Removes a named route and its aliases. Returns whether anything was removed. */
  removeRoute: (name: string) => boolean;
  /** Where this router is now — `undefined` until it has routed once. */
  readonly currentRoute: RouteSnapshot | undefined;
  deleteRouter: () => void;
  on: (event: RouteEvent, handler: RouteEventHandler) => void;
  off: (event: RouteEvent, handler: RouteEventHandler) => void;
}

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

export type RouteEventHandler = (to: RouteSnapshot, from?: RouteSnapshot) => unknown | Promise<unknown>;



/**
 * A match result contains data about the path match.
 */
export interface MatchResult<P extends ParamData> {
  path: string;
  params: P;
}
/**
 * A match is either `false` (no match) or a match result.
 */
export type Match<P extends ParamData> = false | MatchResult<P>;
/**
 * The match function takes a string and returns whether it matched the path.
 */
export type MatchFunction<P extends ParamData> = (path: string) => Match<P>;
