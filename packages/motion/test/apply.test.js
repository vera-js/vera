import { describe, it } from './harness.mjs';
import { expect } from './expect.mjs';
import { composeTransform, composeFilter, applyProperty, sortForApply } from '../src/modules/apply.ts';
import { getProperty } from '../src/modules/schema.ts';

const anim = (attribute, unit = '') => ({ property: getProperty(attribute), unit });
const node = () => document.createElement('div');

describe('composeTransform', () => {
  it('composes one string from all transform animations', () => {
    expect(composeTransform({
      animations: [anim('translate-y', 'px'), anim('rotate', 'deg')],
      values: [10, 45],
    })).toBe('translateY(10px) rotate(45deg)');
  });

  it('keeps a prefix ahead of the animated functions', () => {
    expect(composeTransform({ animations: [anim('scale')], values: [2] }, 'translateZ(0px)'))
      .toBe('translateZ(0px) scale(2)');
  });

  it('rounds to three decimals, since finer cannot render', () => {
    expect(composeTransform({ animations: [anim('translate-y', 'px')], values: [10.123456] }))
      .toBe('translateY(10.123px)');
  });

  it('never emits -0', () => {
    expect(composeTransform({ animations: [anim('translate-y', 'px')], values: [-0.0001] }))
      .toBe('translateY(0px)');
  });

  it('accepts a typed array, which is what the runtime passes', () => {
    expect(composeTransform({ animations: [anim('scale')], values: Float64Array.from([1.5]) }))
      .toBe('scale(1.5)');
  });

  /** Identical input must give an identical string, or the write-skip cache never hits. */
  it('is deterministic for identical input', () => {
    const write = { animations: [anim('translate-y', 'px')], values: [10] };
    expect(composeTransform(write)).toBe(composeTransform(write));
  });
});

describe('composeFilter', () => {
  it('composes filter functions', () => {
    expect(composeFilter({ animations: [anim('opacity'), anim('blur', 'px')], values: [0.5, 4] }))
      .toBe('opacity(0.5) blur(4px)');
  });
});

describe('applyProperty', () => {
  it('sets a named CSS property with its unit', () => {
    const n = node();
    applyProperty(n, getProperty('radius-top-left'), 'px', 12);
    expect(n.style.getPropertyValue('border-top-left-radius')).toBe('12px');
  });

  it('does nothing for a property that names no CSS and carries no apply', () => {
    const n = node();
    applyProperty(n, { attribute: 'nothing', category: 'border', defaultUnit: '', units: [''], initial: 0 }, '', 5);
    expect(n.getAttribute('style')).toBeFalsy();
  });

  /** A module property writes through its own hook instead of naming CSS. */
  it('calls a property\'s own apply when it has one', () => {
    const n = node();
    const seen = [];
    applyProperty(n, {
      attribute: 'packed', category: 'border', defaultUnit: '', units: [''], initial: 0,
      apply: (node, value) => seen.push([node, value]),
    }, '', 7);
    expect(seen).toEqual([[n, 7]]);
    expect(n.getAttribute('style')).toBeFalsy();
  });
});

describe('sortForApply', () => {
  /** CSS transform functions do not commute, so order cannot come from markup. */
  it('orders by schema declaration, not input order', () => {
    const sorted = sortForApply([anim('skew-x'), anim('scale'), anim('translate-y'), anim('rotate')]);
    expect(sorted.map((a) => a.property.attribute)).toEqual(['translate-y', 'rotate', 'scale', 'skew-x']);
  });

  it('does not mutate its input', () => {
    const input = [anim('scale'), anim('translate-y')];
    const copy = [...input];
    sortForApply(input);
    expect(input).toEqual(copy);
  });
});
