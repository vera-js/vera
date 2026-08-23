export { Autoloader } from '@verajs/shared-types';

export type RouteTrigger = 'init' | 'navigate' | 'replace' | 'popstate' | 'hashchange';

export type RouteParams = Partial<Record<string, string | string[]>>;

/** Alias — same shape as {@link RouteParams}, kept for path-to-regexp-compatible naming. */
export type ParamData = RouteParams;

export type RouteAction = (params: RouteParams, to: RouteSnapshot, from?: RouteSnapshot) => unknown;

export type TypedRouteAction<T> = (params: ParseRouteParams<T>, to: Route, from?: Route) => unknown;

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
}

/**
 * Arbitrary data attached to a route and handed to every guard, action and component on the
 * snapshot. This is where `requiresAuth`, a layout name, a breadcrumb label or an analytics id
 * belong: the router never reads it, so a guard can decide on the route's own terms instead of
 * re-parsing its path.
 */
export type RouteMeta = Record<string, unknown>;

export type Route = {
  pattern?: string;
  keys?: string[];
  regExp?: RegExp;
  matchFunction?: MatchFunction<ParamData>;
} & RouteOptions;

export interface RouteOptions {
  path: (() => string) | string;
  title?: RouteAction | string;
  /** Arbitrary data for guards to read off the snapshot — see {@link RouteMeta}. */
  meta?: RouteMeta;
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

export interface RouterMethods {
  addRoutes: (routes: RouteOptions[]) => void;
  /** Where this router is now — `undefined` until it has routed once. */
  readonly currentRoute: RouteSnapshot | undefined;
  deleteRouter: () => void;
  on: (event: RouteEvent, handler: RouteEventHandler) => void;
  off: (event: RouteEvent, handler: RouteEventHandler) => void;
}

// Thanks, https://type-level-typescript.com !
export type ParseRouteParams<url> = url extends `${infer start}/${infer rest}`
  ? ParseRouteParams<start> & ParseRouteParams<rest>
  : url extends `:${infer param}`
  ? { [k in param]: string }
  : object;

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
