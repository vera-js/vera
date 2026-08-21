import { StoreProxyKeys } from '@verajs/shared-types';

/** A component element with optional methods and properties */
export type ComponentElement = HTMLElement & ComponentMethods & ComponentProperties;

/** Hooks queue properties shape. We redefine c and e because they are WeakRefs */
export interface ComponentHook extends Omit<Hook, 'element' | 'callback'> {
  /** Callback to execute when hook is triggered */
  callback: WeakRef<HookCallback> | null;
  /** Element WeakRef */
  element?: WeakRef<ComponentElement>;
}

/** A component instance with a WeakRef to the current element */
export type ComponentInstance = {
  /** Instance element WeakRef*/
  element?: WeakRef<ComponentElement> | null;
};

/** The methods attached to an instance when a store is created */
export type ComponentMethods = {
  /** Wrapped by `init` to run effect cleanups on removal; an author's own method is chained. */
  disconnectedCallback?: () => void;
  /**
   * Function that will manually run all hooks on an element. If custom functionality
   * is needed, render can be replaced with useRender and runHooks();
   */
  runHooks?: () => void;
};

/** The properties that can be attached to an   */
export type ComponentProperties = {
  /**
   * The elements hooks. Hooks are attached directly to the element so that when it's
   * garbage collected, all of it's hooks go with it. The runHooks method uses this
   * property as a reference to the element's hooks
   */
  _hooks?: Hooks;
  /** Priorities parallel to `_hooks`, which is kept dense rather than indexed by priority */
  _hookPriorities?: number[];
  /** Effect cleanups awaiting disconnect, kept here so removal can run them (see `init`). */
  _cleanups?: Set<HookCleanup>;
};

/** Styles to be applied */
export type CSSResultGroup = { styleSheet: CSSStyleSheet; cssText: string };

/** Hook with a callback and priority */
export interface Hook {
  /** Callback to execute when hook is triggered */
  callback: HookCallback | null;
  /** Element to bind hook to, ignoring the init element */
  element?: ComponentElement;
  /** Priority relative to other hooks */
  priority: number | null;
}

/** Represents a callback function for hooks */
/** Returned from a hook to undo whatever it set up; run before the next pass and on teardown. */
export type HookCleanup = () => void;

export type HookCallback = <V>(signal?: Signal<V>, init?: boolean) => void | HookCleanup;

/** Hook with a callback and priority */
export type Hooks = Set<HookCallback>[];

/** The template that is passed to the renderer is a useRender hook and the render helper function */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RenderTemplate = <V>(signal?: Signal<V>) => any;

/**
 * Marker values distinguishing template kinds, matching lit's numbering: html, svg, mathml.
 * Defined here rather than imported so core keeps no dependency on lit — `setHtml` exists precisely
 * so the template function can be swapped.
 */
export type ResultType = 1 | 2 | 3;

/**
 * The object core's built-in `html` tag produces.
 *
 * Structurally compatible with lit-html's `TemplateResult`, so a lit renderer consumes it directly.
 * It was previously referenced in `store.ts` without ever being defined or imported, which meant the
 * emitted `.d.ts` carried a dangling reference and every TypeScript consumer got
 * `TS2304: Cannot find name 'TemplateResult'` on import.
 */
export type TemplateResult<T extends ResultType = 1> = {
  _$litType$: T;
  strings: TemplateStringsArray;
  values: unknown[];
};

/** One property's delta across a coalesced batch */
export type SignalChange = { value?: unknown; prevValue?: unknown };

/**
 * Signal parameters.
 *
 * `prop` / `value` / `prevValue` describe the most recent change. `changed` is present on coalesced
 * runs and carries every property touched during the batch, each mapped to its value at the start
 * of the batch and at the end.
 */
export type Signal<V> = {
  /** `PropertyKey | unknown` in truth — collection keys pass through unchanged (objects included). */
  prop?: string;
  value?: V;
  prevValue?: V;
  changed?: Map<string, SignalChange>;
};

/** Represents the store object with additional _isSignal and _ignore properties */
export type Store<T extends object = object> = T & StoreProxyKeys;
