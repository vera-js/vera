import { ProxyObject, StoreProxyKeys } from '@verajs/shared-types';

/**
 * Runs when a store property is **read**, and what it returns becomes the value read.
 *
 * That is the point — it is how a module transforms values on their way out, which is what the
 * `computed` recipe uses to unwrap a box — but it means a handler written only to *observe* must
 * return nothing. `insert('proxy-handler', () => count++, 30)` returns a number, and every read of
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
 * point `@verajs/collections` registers on.
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

export type InsertFunctionMap = {
  'proxy-handler': ProxyHandlerInsert;
  'render': RendererInsert;
  'set-handler': SetHandlerInsert;
  'error': ErrorInsert;
  'init': InitInsert;
  'collection': CollectionInsert;
};

export type Inserts = Map<
  keyof InsertFunctionMap,
  (ProxyHandlerInsert | RendererInsert | SetHandlerInsert | ErrorInsert | InitInsert | CollectionInsert)[]
>;
