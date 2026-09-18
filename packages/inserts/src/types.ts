import type { ProxyObject, StoreProxyKeys } from '@verajs/shared-types';

/**
 * Runs when a store property is **read**, and what it returns becomes the value read.
 *
 * That is the point — it is how a module transforms values on their way out, which is what the
 * `computed` recipe uses to unwrap a box — but it means a handler written only to *observe* must
 * return nothing. `wire({ on: 'proxy-handler', fn: () => count++, priority: 30 })` registers a callback returning a number, and every read of
 * every store then yields that number instead of the value: silent, total, and indistinguishable
 * from the store being broken.
 *
 * `undefined` and `null` both leave the value alone (`?? propValue`), so a block-bodied arrow —
 * `() => { count++; }` — is the safe shape for an observer.
 */
export type ProxyHandlerInsert = <T extends object>(
  obj: T & StoreProxyKeys,
  prop: Extract<keyof T, string>,
  propValue: ProxyObject<T>,
  addCallback: (obj: T & StoreProxyKeys, prop: Extract<keyof T, string>) => void,
  runCallbacks: <T extends object>(
    obj: T,
    prop: Extract<keyof T, string>,
    value: T[Extract<keyof T, string>],
    prevValue: T[Extract<keyof T, string>]
  ) => void
) => ProxyObject<T>;

/**
 * The renderer chain: what `render()` calls to put a template on screen. Core ships none, so an app
 * with no renderer wired warns in development and displays nothing.
 *
 * `any` rather than `unknown` throughout, and this is the reason (CODE-PRINCIPLES §1.8 wants it
 * stated): the template argument is whatever the WIRED renderer's tag produced, a type this
 * package cannot name without depending on every renderer that might be wired — which is exactly
 * the dependency the insert system exists to avoid. `unknown` does not work in its place, because
 * every renderer would then have to cast its own template type back out at its entry point. The
 * looseness is confined to this one signature; each renderer's own surface is fully typed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RendererInsert = (template: any, container: HTMLElement, ...args: any[]) => any;

/**
 * Runs when a store property is written, before the default propagation.
 *
 * Returning `false` suppresses that default propagation, which is what lets a module hold changes
 * back and flush them itself — batching, transactions, undo/redo, persistence, time-travel devtools.
 * Any other return value leaves the default behaviour alone.
 */
export type SetHandlerInsert = <T extends object>(
  obj: T,
  prop: Extract<keyof T, string>,
  value: unknown,
  prevValue: unknown,
  runCallbacks: <O extends object>(
    obj: O,
    prop: Extract<keyof O, string>,
    value: O[Extract<keyof O, string>],
    prevValue: O[Extract<keyof O, string>]
  ) => void
) => boolean | void;

/**
 * Runs when a hook callback throws. Core never lets the error escape — one failing effect must not
 * stop the others on the same element — so this is where a module decides what to do with it:
 * an error boundary, a fallback render, a report to an error tracker.
 *
 * With nothing registered, core falls back to `console.error` so failures stay visible.
 */
export type ErrorInsert = (error: unknown, element?: HTMLElement) => void;

/**
 * Runs when `init()` sets an element up — after its shadow root exists, before its first render.
 * The extension point for anything that needs to see every component as it comes to life:
 * `static styles` adoption (`@verajs/styles`), instrumentation, per-element registration.
 *
 * Core dispatches it and knows nothing about what is registered. With nothing registered it is one
 * `Map.get` returning `undefined`, once per element.
 */
export type InitInsert = (element: HTMLElement) => void;

/**
 * Returns a tracking wrapper for a `Map`/`Set` method read through a store proxy — the extension
 * point `@verajs/store/collections` registers on.
 *
 * **Type-keyed, not per-read.** Core dispatches it only when the target is already known to be a
 * `Map` or a `Set`, so a plain-object read never reaches the lookup. That is the whole difference
 * from `'proxy-handler'`, which runs on every read of every store and is why reactive collections
 * could not affordably live out of core before.
 *
 * With nothing registered, a `Map` in a store is inert — core raises a `__DEV__` error naming the
 * package rather than letting the mutation pass silently.
 */
export type CollectionInsert = (
  obj: object,
  prop: PropertyKey,
  propValue: unknown,
  addCallback: (obj: never, prop: never) => void,
  runCallbacks: (obj: never, prop: never, value: never, prevValue: never) => void
) => unknown;

/**
 * Claims a value at a **child position** — `<div>${value}</div>` — by inspecting it.
 *
 * The point of this one is types you do not own. `_$child$` requires a property on the value, which
 * is fine for `keyed()` or a directive you wrote and impossible for a `Promise`, an `Observable` or a
 * `Temporal.PlainDate`. Return `true` to say the value is handled and stop the chain.
 *
 * Declared here rather than structurally in the renderer so `wire([renderer])` typechecks for a
 * consumer: a descriptor's `connect` receives the whole `Inserts` map, and a narrower parameter is
 * not assignable to that.
 */
export type ValueInsert = (part: object, value: unknown) => boolean | void;

/**
 * Takes over one `<slot>` in a LIGHT-DOM render — `@verajs/renderer/slots`. The renderer hands it
 * the cloned `<slot>` element, the root being rendered into, and the slot's name; returning null or
 * undefined declines, which is what happens for a shadow root (the platform slots there) and under
 * the SSR shim (the server distributes through its own pass instead).
 *
 * Declared here for the same reason `ValueInsert` is: without it `wire([renderer, slots])` does not
 * typecheck for a consumer, because a descriptor's `on` is `keyof InsertFunctionMap` and `'slot'`
 * was not one of them. The insert existed at runtime and only at runtime — every recipe that wired
 * it ran as JavaScript, so nothing noticed.
 */
export type SlotInsert = (
  slot: Element,
  root: Node,
  name: string
) => { _$park$?: () => void } | null | undefined;

/**
 * Resolves a DIRECTIVE NAME nobody has wired to a module that provides it — the seam
 * `@verajs/directives` asks (through the substrate stamp) before rejecting an unknown
 * `data-vd-*` name, and `@verajs/autoloader`'s `directiveLoader` answers by convention
 * (`{base}/{name}.js`). First claimer wins: return the `import()` promise (or any truthy) to
 * claim, `false`/`undefined` to decline. A claimed module REGISTERS ITSELF by importing
 * `wireDirectives` from the same specifier the page used — module caching makes that the same
 * registry, the exact symmetry of an autoloaded component calling `customElements.define`.
 * The asker re-checks its registry when the promise settles; loading is memoized by the
 * answerer, refusal by the asker.
 */
export type LoaderInsert = (name: string, element: Element) => boolean | Promise<unknown> | void;

/**
 * Runs during a SERVER render, once a component's tree is FINAL — its lifecycle has run, its
 * frames are drained, and the markup is about to be serialized. The last honest moment to write
 * to a server-rendered tree, and the only one that exists: a server has no observer and no second
 * pass, so `'init'` (which fires before the first render) is too early for anything that reads
 * rendered content.
 *
 * `@verajs/directives` is the first consumer — it evaluates declarative directives into the
 * markup here, so reflections are correct before any JavaScript reaches the browser. Anything
 * that needs to transform a finished server tree belongs here too.
 */
export type SettleInsert = (element: HTMLElement) => void;

/**
 * Every extension point in the framework, and the signature each one's chain must satisfy. This map
 * is the whole contract: adding a point means adding a line here, and `wire` will then accept it.
 */
export type InsertFunctionMap = {
  'proxy-handler': ProxyHandlerInsert;
  'render': RendererInsert;
  'set-handler': SetHandlerInsert;
  'error': ErrorInsert;
  'init': InitInsert;
  'collection': CollectionInsert;
  'value': ValueInsert;
  'slot': SlotInsert;
  'loader': LoaderInsert;
  'settle': SettleInsert;
};

/**
 * The registry itself — one `Map` from point name to its chain, held by core and handed to any
 * module that asks for it.
 *
 * There is exactly one per app, and that is load-bearing rather than incidental: production bundles
 * inline their dependencies, so a module that imported `@verajs/inserts` and built its own registry
 * would write to a map core never reads — working in development and silently doing nothing in
 * production. Modules take `wire` from `@verajs/core` for this reason.
 */
export type Inserts = Map<
  keyof InsertFunctionMap,
  (
    | ProxyHandlerInsert
    | RendererInsert
    | SetHandlerInsert
    | ErrorInsert
    | InitInsert
    | CollectionInsert
    | ValueInsert
    | SlotInsert
    | LoaderInsert
    | SettleInsert
  )[]
>;

/**
 * Everything an app can hand to {@link wire}: a **descriptor** naming the chain it belongs
 * in, or a **connector** — a function handed the registry, which is how a package that imports
 * nothing gets wired to it.
 */
export type InsertDescriptor = {
  on: keyof InsertFunctionMap;
  fn: InsertFunctionMap[keyof InsertFunctionMap];
  priority: number;
  /** For the collision message below. A package should set it; an inline descriptor need not. */
  name?: string;
  /**
   * Called with the registry as the descriptor is wired, for a package that also needs to *read* a
   * chain. `@verajs/renderer` uses it: the same entry that registers it as the renderer hands it
   * the registry it reads `'value'` handlers from, so an app writes one thing, not two.
   */
  connect?: (registry: Inserts) => void;
};
/**
 * A function handed the registry instead of a chain entry — how a package that registers nothing
 * still gets a reference to the map core reads. It is told apart from a descriptor structurally:
 * a function whose `on` is `undefined` is a connector.
 */
export type Connector = (registry: Inserts) => void;

/** Either form {@link wire} accepts, so a module can ship as whichever one suits it. */
export type Registerable = InsertDescriptor | Connector;
