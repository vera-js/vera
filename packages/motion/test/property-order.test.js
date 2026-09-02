/**
 * Transform order is decided entirely by declaration order, with no ties.
 *
 * CSS transform functions do not commute — `translateY(40px) scale(2)` and
 * `scale(2) translateY(40px)` put the element in different places — so
 * `sortForApply` sorts every element's animations by `propertyOrder` before the
 * string is composed, and CLAUDE.md calls that load-bearing.
 *
 * `Array.prototype.sort` is **stable**. That is normally a virtue and here it
 * hides a trap: two properties sharing an order value would not be ordered by
 * the schema at all, they would keep the order the *attributes* happened to be
 * written in — which is precisely the thing the sort exists to stop, and it
 * would look correct on every page whose author wrote them in schema order.
 *
 * `runtime-invariants.mjs` checks the resulting string in three engines with
 * the attributes written deliberately backwards. This checks the property that
 * makes that possible, over the whole registry rather than one element's four.
 */
import { describe, it } from './harness.mjs';
import { expect } from './expect.mjs';
import { properties, wireMotion } from '../src/index.ts';
/** `propertyOrder` is internal — not part of the public surface, and `check-imports` said so. */
import { propertyOrder } from '../src/modules/schema.ts';
import { paint } from '../src/paint.ts';
import { sequence } from '../src/sequence.ts';
import { sortForApply } from '../src/modules/apply.ts';

wireMotion([paint, sequence()]);

describe('propertyOrder', () => {
  it('gives every property in the live registry a distinct value', () => {
    const seen = new Map();
    for (const property of properties()) {
      const order = propertyOrder(property);
      const twin = seen.get(order);
      expect(twin, `${property.attribute} shares order ${order} with ${twin}`).toBeUndefined();
      seen.set(order, property.attribute);
    }
    expect(seen.size).toBe(properties().length);
  });

  it('sorts the same however the attributes were written', () => {
    const all = properties().map((property) => ({ property }));
    const forwards = sortForApply(all).map((a) => a.property.attribute);
    const backwards = sortForApply([...all].reverse()).map((a) => a.property.attribute);
    const shuffled = sortForApply(
      [...all].sort((a, b) => a.property.attribute.localeCompare(b.property.attribute))
    ).map((a) => a.property.attribute);

    expect(backwards).toEqual(forwards);
    expect(shuffled).toEqual(forwards);
  });

  it('puts the transform functions in the documented order', () => {
    const order = sortForApply(
      ['skew-x', 'scale', 'rotate', 'translate-y']
        .map((attribute) => ({ property: properties().find((p) => p.attribute === attribute) }))
    ).map((a) => a.property.attribute);
    expect(order).toEqual(['translate-y', 'rotate', 'scale', 'skew-x']);
  });
});
