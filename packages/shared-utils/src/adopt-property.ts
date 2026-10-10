import type { PropertyHost } from './types.js';
import { diagnostic } from './diagnostic.js';
import * as SHARED from './diagnostics.js';

/**
 * **Delivering a bound property to a custom element that may not receive it yet** — the one home of the
 * rule `@verajs/renderer` (a `.prop` template binding) and `@verajs/renderer/spread` (a `.prop` bag key)
 * both apply. They ship as separate bundles that cannot import each other, so this package, inlined into
 * each, is where the rule lives once; before, each carried a full copy and a fix had to visit both.
 *
 * Returns where the binding stands after this write:
 * - `0` — still adopting: nothing received the value, so it was recorded in the element-carried
 *   `_$props$`, which core's `init()` drains over whatever the class's field initializers wrote at
 *   upgrade. Call again on the next write.
 * - `1` — received (a setter anywhere on the chain, an initialized component's `_$adopt$`, or an element
 *   that is already upgraded): later writes are plain property writes.
 * - `2` — refused: a getter with no setter, where the plain write would throw. Later writes do nothing.
 *
 * `_$props$` and `_$adopt$` are `$`-named because they cross bundle boundaries (renderer, spread, core)
 * and must survive property mangling.
 *
 * **`_$adopt$` is a BRAND, not just a slot:** present means "core has initialized this component", which is what routes
 * a delivery to the live accessor (`1`) instead of the `_$props$` record. Do not move it to a class's PROTOTYPE to save
 * the closure per element (R1's C6, 2026-10-10): every instance would carry it BEFORE `init`, and a delivery to an
 * upgraded-but-uninitialized element would be adopted into a store that does not exist yet. The closure was raced
 * against one shared function in three engines and costs nothing measurable — there is no saving to chase.
 */

/** Development only: getter-only names already reported, per element — a `!name` re-asserts on every render. */
let refused: WeakMap<PropertyHost, Set<string>> | undefined;

export const adoptProperty = (element: PropertyHost, name: string, value: unknown): 0 | 1 | 2 => {
  const adopt = element._$adopt$ as ((key: string, value: unknown) => void) | undefined;
  /** The walk comes first: what it finds decides whether writing is even legal. */
  for (let carrier: object | null = element; carrier !== null; carrier = Object.getPrototypeOf(carrier)) {
    const desc = Object.getOwnPropertyDescriptor(carrier, name);
    if (desc === undefined) continue;
    if (desc.set !== undefined) {
      element[name] = value;
      return 1;
    }
    if (desc.get !== undefined) {
      if (adopt !== undefined) adopt(name, value);
      else if (__DEV__) {
        const names = (refused ??= new WeakMap()).get(element) ?? new Set<string>();
        refused.set(element, names);
        if (!names.has(name)) {
          names.add(name);
          console.warn(diagnostic('renderer', `<${element.localName}>`, 'getter-only-prop', __DEV__ && SHARED.getterOnlyProp(name)));
        }
      }
      return 2;
    }
    break; // a data property: an own field, or an inherited default — nothing receives it
  }
  element[name] = value;
  if (adopt !== undefined) {
    adopt(name, value);
    return 1;
  }
  const record = (element._$props$ ??= {}) as Record<string, unknown>;
  const first = __DEV__ && !Object.hasOwn(record, name);
  record[name] = value;
  /** Upgrade is read off the PROTOTYPE — a bag key named `constructor` can shadow `el.constructor`. The realm is the element's. */
  const view = element.ownerDocument.defaultView as unknown as {
    HTMLElement: { prototype: object };
    customElements: CustomElementRegistry;
  } | null;
  const upgraded = view === null || Object.getPrototypeOf(element) !== view.HTMLElement.prototype;
  /** Development only: an element that never drains still loses the value at upgrade — told apart by ownership. */
  if (__DEV__ && view !== null && !upgraded && first) {
    const tag = element.localName;
    view.customElements.whenDefined(tag).then(() => {
      let owned = false;
      for (let carrier: object | null = element; carrier !== null; carrier = Object.getPrototypeOf(carrier)) {
        const desc = Object.getOwnPropertyDescriptor(carrier, name);
        if (desc === undefined) continue;
        owned = desc.get !== undefined || desc.set !== undefined;
        break;
      }
      if (!owned && element[name] !== record[name])
        console.warn(diagnostic('renderer', `<${tag}>`, 'upgrade-clobber', __DEV__ && SHARED.upgradeClobber(name)));
    });
  }
  return upgraded ? 1 : 0;
};
