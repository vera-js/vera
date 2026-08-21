import { ProxyObject, StoreProxyKeys } from '@verajs/shared-types';

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

export type InsertFunctionMap = {
  'proxy-handler': ProxyHandlerInsert;
  'render': RendererInsert;
  'set-handler': SetHandlerInsert;
  'error': ErrorInsert;
};

export type Inserts = Map<
  keyof InsertFunctionMap,
  (ProxyHandlerInsert | RendererInsert | SetHandlerInsert | ErrorInsert)[]
>;
