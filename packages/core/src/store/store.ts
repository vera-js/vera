import { misuse, SHARED } from '@verajs/shared-utils';
import type { ComponentElement, ResultType, HookRecord, Subscribers, TemplateResult } from '../types.js';

/** The element between `init()` and the `render()` that commits it — hooks register against it. */
export const currentInstance: { element: ComponentElement | null } = { element: null };

/**
 * The hooks currently running, innermost last. A store read records whatever is on top as a
 * dependency. A stack rather than one slot because a hook can run inside another — a nested
 * component rendering in the middle of its parent's template.
 */
/**
 * **The components THIS copy of core initialized** — what its `customElements.define` wrapper may tear down, and the
 * owners whose effects keep a cleanup Set. A page can load two copies of core (a bundle inlining it); each keeps its own.
 */
export const mine = new WeakSet<Element>();

/**
 * **The hook reading right now — ONE cell, not a stack** (work queue 6, A14a, 2026-10-16). Every tracked store read asks
 * it who to subscribe (`track`). Each place that starts a run — a hook's run (`$t`), `untracked`, `init`'s setup window —
 * saves the cell, sets it, and restores it in its `finally`, so nesting (a `computed` read inside a render) lives on the
 * call stack and a throw restores the outer reader. The one "current subscriber" signals-readiness asks for. An exported
 * CONST object with a mutable field — never an exported `let`, which would be a live binding on the read path.
 */
export const tracking: { hook: HookRecord | undefined } = { hook: undefined };

/**
 * Every subscription: target object → key → the hooks that read it. The hooks are held **weakly** —
 * their element holds them strongly — so a removed element's HOOKS go with it. The `WeakRef`s left behind are swept:
 * by `trigger` when the key is written, and by `track` when a Set grows to its limit (a key never written included).
 *
 * A key is anything a store module tracks — a property, or a collection's entry key, an object
 * included. A weak collection's container is really a `WeakMap` (see `track`); it is declared as a
 * `Map` because only `get` and `set` are ever called on it, which the two share, and a union would
 * make every read narrow for a difference that does not exist at these call sites.
 */
export const proxyCallbacks = new WeakMap<object, Map<unknown, Subscribers>>();

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
      throw new TypeError(misuse(name, 'tag-called', __DEV__ && SHARED.tagCalled(name, typeof strings === 'string' ? JSON.stringify(strings) : String(strings), '<p>hi</p>')));
    }
    return { ['_$litType$']: type, strings, values };
  };

/** The `html` tagged template. */
export const html = tag(1);
/** The `svg` tagged template — markup parsed as SVG, for a fragment that is not inside an `<svg>` element. */
export const svg = /* @__PURE__ */ tag(2);
/** The `mathml` tagged template — markup parsed as MathML, for a fragment that is not inside a `<math>` element. */
export const mathml = /* @__PURE__ */ tag(3);
