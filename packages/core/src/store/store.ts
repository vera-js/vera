import type { ComponentElement, HookCallback, TemplateResult } from '../types.js';

/** The element between `init()` and the `render()` that commits it — hooks register against it. */
export const currentInstance: { element: ComponentElement | null } = { element: null };

/**
 * The hooks currently running, innermost last. A store read records whatever is on top as a
 * dependency. A stack rather than one slot because a hook can run inside another — a nested
 * component rendering in the middle of its parent's template.
 */
export const hooksQueue: WeakRef<HookCallback>[] = [];

/**
 * Every subscription: target object → property → the hooks that read it. The hooks are held
 * **weakly** — their element holds them strongly — so a removed element's subscriptions go with it.
 */
export const proxyCallbacks = new WeakMap<object, Map<PropertyKey, Set<WeakRef<HookCallback>>>>();

/** The `html` tagged template: the strings and values, for a renderer to consume. */
export const html = (strings: TemplateStringsArray, ...values: unknown[]): TemplateResult => ({
  ['_$litType$']: 1,
  strings,
  values,
});
