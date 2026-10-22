import { diagnostic, SHARED } from '@verajs/shared-utils';
import { RENDER_PRIORITY } from './createHook.js';
import { createStore } from './createStore.js';
import type { ComponentElement } from '../types.js';

/**
 * **Adopt what the parent's property bindings delivered — no declaration required.**
 *
 * `_$props$` is the renderer's record of every `.name`/`props()` value nothing received: on a LAZY tag
 * the raw write was clobbered by the class's field initializers at upgrade, and on an EAGER one it
 * survived but is indistinguishable from the component's own fields by now — the record is what tells
 * them apart, which is why adoption needs neither `static properties` nor a props argument. Draining it
 * seeds one store with the bound values and puts a store-backed accessor where each raw property was,
 * so `this.date` read in a render is TRACKED and the parent's next commit lands in the setter:
 * reactivity in both directions. A bound value outranks a class default, which is what props mean.
 *
 * The record only covers values that arrived before `init()`. A hydrated child is defined, connected
 * and drained before its parent's parts commit, and a spread bag can grow a key on a live element, so
 * each key goes through **`_$adopt$`**, the live receiver this installs on each element (sigiled: the
 * recorders live in other bundles) — a late delivery takes the same door instead of a record nobody
 * reads again. ONE shared function for every element, called as a method; the store is the element's
 * own (`createStore` of its `_$raw$`, the same proxy every time), so every generation shares it.
 *
 * @param element The element `init()` is setting up
 */
/**
 * Development: a bound property met a GETTER-ONLY class member — refused, and said once per element and name (main
 * had this; the lean rebuild dropped it, so the binding vanished silently). The renderer's eager path hands the value
 * here (`_$adopt$`), so this is the one place both arrival orders end.
 */
const refused = /* @__PURE__ */ new WeakMap<Element, Set<string>>();
const refuse = (element: Element, key: string) => {
  const names = refused.get(element) ?? new Set<string>();
  refused.set(element, names);
  if (names.has(key)) return;
  names.add(key);
  console.warn(diagnostic('core', `<${element.localName}>`, 'getter-only-prop', __DEV__ && SHARED.getterOnlyProp(key)));
};

/**
 * **The ONE receiver every component shares** (R2.5, 2026-10-11): called as a METHOD — `element._$adopt$(key, value)`,
 * or `adopt.call(element, …)` from shared-utils' `adoptProperty` — so the element is `this` and no closure is created per
 * element. Its props store is `createStore` of the element's raw record, which returns the same proxy every time.
 */
function adopt(this: ComponentElement, key: string, value: unknown) {
    const el = this as unknown as Record<string, unknown>;
    /**
     * **A key something already receives is handed over, never adopted** — an accessor of the
     * element's own, or a setter on its prototype chain, runs as the class wrote it. The lazy flow can
     * leave an own DATA property (the raw pre-upgrade write, or the field that clobbered it) in front
     * of that pair, so it is deleted first. Descriptors only: reading `proto[key]` would invoke a getter
     * with the prototype as `this`, which throws for one built on private fields. A GETTER-ONLY key
     * cannot be delivered and is refused — its residue cleared, so the class's getter answers again.
     */
    const own = Object.getOwnPropertyDescriptor(this, key);
    if (own?.get || own?.set) {
      el[key] = value;
      return;
    }
    for (let proto = Object.getPrototypeOf(this); proto !== null; proto = Object.getPrototypeOf(proto)) {
      const desc = Object.getOwnPropertyDescriptor(proto, key);
      if (desc === undefined) continue;
      if (desc.set || desc.get) {
        if (own) delete el[key];
        if (desc.set) el[key] = value;
        else if (__DEV__) refuse(this, key);
        return;
      }
      break;
    }
    delete el[key];
    Object.defineProperty(this, key, accessorFor(key));
    propsOf(this)[key] = value;
    /**
     * A key arriving AFTER the drain reaches a render that never read it through the store — its
     * first read was a plain `undefined`, untracked — so no write would repaint. The element's RENDER
     * hooks run once: the pass reads the new accessor, which subscribes it for every later commit.
     * Effects are not forced — a side effect must not re-fire because a prop arrived. During the drain
     * this is a no-op: `init()` has just reset the hooks.
     */
    const hooks = this._$h$;
    if (hooks !== undefined)
      for (let i = 0; i < hooks.length; i++) {
        const hook = hooks[i]!;
        if (hook._y === RENDER_PRIORITY) hook.$n({}, true);
      }
}

/**
 * **The element's props store** — ONE per record, cached on the element (`_$v$`), shared by adopted and declared props:
 * a `define` tag's defaults (`_$fill$`, on its prototype) build or complete the record the first time. Read through it,
 * never through a captured store, so core's teardown can RELEASE it at a real removal (swap the record for a plain copy,
 * drop the store) and every accessor follows the new record on its next read (2026-10-21).
 */
export const propsOf = (element: ComponentElement): Record<string, unknown> =>
  element._$v$ ?? (element._$v$ = createStore((element._$raw$ ??= {})));
/** A `define` tag's: the store with its defaults written first (A1: no `_$fill$` read on a CLASS component's path). */
export const filledOf = (element: ComponentElement, fill: (raw: Record<string, unknown> | undefined) => Record<string, unknown>): Record<string, unknown> =>
  element._$v$ ?? (element._$v$ = createStore((element._$raw$ = fill(element._$raw$))));

/** One accessor pair per KEY, shared by every element that adopts it (it reads `this`) — no closure per element. */
const accessors = new Map<string, PropertyDescriptor>();
const accessorFor = (key: string) => {
  let pair = accessors.get(key);
  if (pair === undefined)
    accessors.set(
      key,
      (pair = {
        get(this: ComponentElement) {
          return (this._$v$ ?? propsOf(this))[key];
        },
        set(this: ComponentElement, next: unknown) {
          (this._$v$ ?? propsOf(this))[key] = next;
        },
        configurable: true,
        enumerable: true,
      })
    );
  return pair;
};

export const adoptProps = (element: ComponentElement) => {
  element._$adopt$ ??= adopt;
  const record = element._$props$;
  if (record !== undefined) {
    delete element._$props$;
    for (const key of Object.keys(record)) element._$adopt$(key, record[key]);
  }
};
