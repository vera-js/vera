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
 * each key goes through **`_$adopt$`**, the live receiver this installs once per element (sigiled: the
 * recorders live in other bundles) — a late delivery takes the same door instead of a record nobody
 * reads again. Installed once and never again: a second closure would open a second store and split
 * the accessors between generations.
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

export const adoptProps = (element: ComponentElement) => {
  if (element._$adopt$ === undefined) {
    let state: Record<string, unknown> | undefined;
    element._$adopt$ = (key, value) => {
      const el = element as unknown as Record<string, unknown>;
      /**
       * **A key something already receives is handed over, never adopted** — an accessor of the
       * element's own, or a setter on its prototype chain, runs as the class wrote it. The lazy flow can
       * leave an own DATA property (the raw pre-upgrade write, or the field that clobbered it) in front
       * of that pair, so it is deleted first. Descriptors only: reading `proto[key]` would invoke a getter
       * with the prototype as `this`, which throws for one built on private fields. A GETTER-ONLY key
       * cannot be delivered and is refused — its residue cleared, so the class's getter answers again.
       */
      const own = Object.getOwnPropertyDescriptor(element, key);
      if (own?.get || own?.set) {
        el[key] = value;
        return;
      }
      for (let proto = Object.getPrototypeOf(element); proto !== null; proto = Object.getPrototypeOf(proto)) {
        const desc = Object.getOwnPropertyDescriptor(proto, key);
        if (desc === undefined) continue;
        if (desc.set || desc.get) {
          if (own) delete el[key];
          if (desc.set) el[key] = value;
          else if (__DEV__) refuse(element, key);
          return;
        }
        break;
      }
      state ??= createStore((element._$raw$ = {}));
      delete el[key];
      Object.defineProperty(element, key, {
        get: () => state![key],
        set: (next: unknown) => {
          state![key] = next;
        },
        configurable: true,
        enumerable: true,
      });
      state[key] = value;
      /**
       * A key arriving AFTER the drain reaches a render that never read it through the store — its
       * first read was a plain `undefined`, untracked — so no write would repaint. The element's RENDER
       * hooks run once: the pass reads the new accessor, which subscribes it for every later commit.
       * Effects are not forced — a side effect must not re-fire because a prop arrived. During the drain
       * this is a no-op: `init()` has just reset the hooks.
       */
      element._$h$?.[element._$p$!.indexOf(RENDER_PRIORITY)]?.forEach((hook) => hook({}, true));
    };
  }
  const record = element._$props$;
  if (record !== undefined) {
    delete element._$props$;
    for (const key of Object.keys(record)) element._$adopt$(key, record[key]);
  }
};
