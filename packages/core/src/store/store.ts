import { misuse, SHARED } from '@verajs/shared-utils';
import type { ComponentElement, HookCallback, ResultType, TemplateResult } from '../types.js';

/** The element between `init()` and the `render()` that commits it — hooks register against it. */
export const currentInstance: { element: ComponentElement | null } = { element: null };

/**
 * The hooks currently running, innermost last. A store read records whatever is on top as a
 * dependency. A stack rather than one slot because a hook can run inside another — a nested
 * component rendering in the middle of its parent's template.
 */
export const hooksQueue: (WeakRef<HookCallback> | undefined)[] = [];

/**
 * Every subscription: target object → key → the hooks that read it. The hooks are held **weakly** —
 * their element holds them strongly — so a removed element's subscriptions go with it.
 *
 * A key is anything a store module tracks — a property, or a collection's entry key, an object
 * included. A weak collection's container is really a `WeakMap` (see `track`); it is declared as a
 * `Map` because only `get` and `set` are ever called on it, which the two share, and a union would
 * make every read narrow for a difference that does not exist at these call sites.
 */
export const proxyCallbacks = new WeakMap<object, Map<unknown, Set<WeakRef<HookCallback>>>>();

/**
 * One tag per template kind: the strings and values, marked with the kind for a renderer to consume.
 *
 * **Called with a string instead of tagged, development names it** (main had this; the lean rebuild dropped it):
 * `html('<p>x</p>')` puts a string where the strings array goes, passes every shape check, and fails much later inside
 * the renderer with "Invalid value used as weak map key", naming nothing. `Array.isArray`, not `raw`: a hand-built
 * `html([markup])` works and is allowed. The name comes from the kind, so production carries no string.
 */
const tag =
  <T extends ResultType>(type: T) =>
  (strings: TemplateStringsArray, ...values: unknown[]): TemplateResult<T> => {
    if (__DEV__ && !Array.isArray(strings)) {
      const name = ['html', 'svg', 'mathml'][type - 1];
      throw new TypeError(misuse(name, 'tag-called', __DEV__ && SHARED.tagCalled(name, typeof strings === 'string' ? JSON.stringify(strings) : String(strings))));
    }
    return { ['_$litType$']: type, strings, values };
  };

/** The `html` tagged template. */
export const html = tag(1);
/** The `svg` tagged template — markup parsed as SVG, for a fragment that is not inside an `<svg>` element. */
export const svg = /* @__PURE__ */ tag(2);
/** The `mathml` tagged template — markup parsed as MathML, for a fragment that is not inside a `<math>` element. */
export const mathml = /* @__PURE__ */ tag(3);
