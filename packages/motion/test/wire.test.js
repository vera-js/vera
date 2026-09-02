import { describe, it } from './harness.mjs';
import { expect } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { properties, insert } from '../src/modules/schema.ts';
import { pageProblems } from '../src/modules/rejections.ts';

const place = (n) => {
  Object.defineProperty(n, 'offsetTop', { value: 500, configurable: true });
  Object.defineProperty(n, 'offsetHeight', { value: 200, configurable: true });
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};
const run = (html) => {
  document.body.innerHTML = html;
  const node = document.body.firstElementChild;
  place(node);
  const m = createMotion({ respectReducedMotion: false, inertia: 0 });
  m.init();
  return { node, m };
};

describe('wireMotion() — property modules', () => {
  it('a wired property with a cssProperty animates end to end', () => {
    wireMotion({
      attribute: 'letter-spacing', category: 'border',
      cssProperty: 'letter-spacing', defaultUnit: 'px',
      units: ['px', 'rem', 'em'], initial: 0,
    });
    const { node, m } = run('<div data-vera-motion data-vera-motion-letter-spacing="0% 0px, 100% 12px"></div>');
    expect(node.style.letterSpacing).not.toBe('');
    expect(m.rejected.flatMap((r) => r.rejected)).toEqual([]);
    m.destroy();
  });

  it('a wired transform function composes after the built-ins', () => {
    wireMotion([{
      attribute: 'hue', category: 'filter',
      cssFunction: 'hue-rotate', defaultUnit: 'deg',
      units: ['deg'], initial: 0,
    }]);
    const { node, m } = run(
      '<div data-vera-motion data-vera-motion-blur="0% 8px, 100% 0px" data-vera-motion-hue="0% 0deg, 100% 90deg"></div>');
    const filter = node.style.filter;
    expect(filter).toContain('hue-rotate(');
    /** Registration order decides composition: built-ins first, modules after. */
    expect(filter.indexOf('blur(')).toBeLessThan(filter.indexOf('hue-rotate('));
    m.destroy();
  });

  it('a wired property works with bands and keyframes like any other', () => {
    const { m } = run(
      '<div data-vera-motion data-vera-motion-letter-spacing="0% 0px, 100% 20px; [0-5000]: 100% 3px"></div>');
    expect(m.elements[0].plan.all[0].bands).toHaveLength(1);
    m.destroy();
  });

  /**
   * A module is often a list — `paint` is five properties — so
   * `wireMotion([paint, easings])` nests. Without flattening the inner array
   * was registered as one property under `undefined` and every property in it
   * silently never appeared.
   */
  it('flattens a nested list of modules', () => {
    const packA = [
      { attribute: 'nested-one', category: 'text', cssProperty: 'letter-spacing',
        defaultUnit: 'px', units: ['px'], initial: 0 },
      { attribute: 'nested-two', category: 'text', cssProperty: 'word-spacing',
        defaultUnit: 'px', units: ['px'], initial: 0 },
    ];
    wireMotion([packA, { attribute: 'nested-three', category: 'text', cssProperty: 'text-indent',
      defaultUnit: 'px', units: ['px'], initial: 0 }]);

    const { node, m } = run(
      '<div data-vera-motion data-vera-motion-nested-one="0% 0px, 100% 5px"' +
      ' data-vera-motion-nested-two="0% 0px, 100% 5px"' +
      ' data-vera-motion-nested-three="0% 0px, 100% 5px"></div>');
    expect(m.rejected.flatMap((r) => r.rejected)).toEqual([]);
    expect(node.style.letterSpacing).not.toBe('');
    expect(node.style.wordSpacing).not.toBe('');
    m.destroy();
  });

  it('an unwired attribute is still reported as unknown', () => {
    const { node, m } = run('<div data-vera-motion data-vera-motion-not-a-thing="0% 0, 100% 1"></div>');
    void node;
    expect(m.rejected.flatMap((r) => r.rejected).some((r) => r.includes('not-a-thing'))).toBe(true);
    m.destroy();
  });
});

/**
 * A descriptor that cannot work is refused **at wiring**, with a reason, rather
 * than by every element that uses it with none.
 *
 * Both of these are only reachable from JavaScript — TypeScript refuses the
 * literals — which is exactly the audience: GUI editors, the demo pages and every
 * hand-written page. The first cost an afternoon in this repository, in a test
 * whose wired property was silently installed as a *setting* and which
 * therefore never had an adopted element to assert about.
 */
describe('wireMotion() — a descriptor that cannot work', () => {
  it('refuses one that is both a setting and a property', () => {
    wireMotion({
      attribute: 'both-kinds', type: 'length', category: 'transform',
      units: ['px'], defaultUnit: 'px', initial: 0, cssProperty: 'left',
    });
    const { m } = run('<div data-vera-motion data-vera-motion-both-kinds="0% 0px, 100% 5px"></div>');
    const said = m.rejected.flatMap((r) => r.rejected).join(' ');
    expect(said).toContain('both a type and a category');
    m.destroy();
  });

  it('and one with no way to write anything', () => {
    wireMotion({
      attribute: 'writes-nowhere', category: 'transform',
      units: ['px'], defaultUnit: 'px', initial: 0,
    });
    const { m } = run('<div data-vera-motion data-vera-motion-writes-nowhere="0% 0px, 100% 5px"></div>');
    const said = m.rejected.flatMap((r) => r.rejected).join(' ');
    expect(said).toContain('no way to write anything');
    m.destroy();
  });

  /** And the reason survives: neither is registered, so the attribute is unknown too. */
  it('and does not register either of them', () => {
    const { m } = run('<div data-vera-motion data-vera-motion-both-kinds="0% 0px, 100% 5px"></div>');
    const said = m.rejected.flatMap((r) => r.rejected).join(' ');
    expect(said).toContain('both-kinds');
    m.destroy();
  });
});

/**
 * A registration that replaces one already there.
 *
 * The registry is a `Map` keyed by attribute, so the last writer wins — and
 * `wireMotion({ attribute: 'opacity', … })` silently replaced the built-in
 * `opacity` page-wide, for every element and every instance. A module author
 * who picks a name core already has takes it from every page that wires them,
 * and nothing anywhere said so.
 *
 * Reported rather than refused: replacing a built-in deliberately is a thing
 * this library invites third parties to do — the custom-property section of the
 * README is exactly that invitation — and refusing would decide it for them.
 * What is not acceptable is doing it by accident and never finding out.
 */
describe('wireMotion() — replacing something already registered', () => {
  const reasons = (m) => m.rejected.flatMap((entry) => entry.rejected ?? []).join(' | ');

  it('says so, naming the attribute', () => {
    wireMotion({
      attribute: 'opacity', category: 'border', cssProperty: 'outline-offset',
      defaultUnit: 'px', units: ['px'], initial: 0,
    });
    const { m } = run('<div data-vera-motion data-vera-motion-opacity="0% 0px, 100% 9px"></div>');
    expect(reasons(m)).toContain('replaced the "opacity" property');
    expect(reasons(m)).toContain('for every element on the page');
    m.destroy();
  });

  /**
   * **Identity, not equality.** Wiring one module twice re-registers the *same*
   * descriptor objects, which is idempotent and not a clash — this is what
   * `wireMotion(paint)` in two files amounts to, and it must stay quiet.
   */
  it('and says nothing when the same module is wired twice', () => {
    const property = {
      attribute: 'twice-over', category: 'border', cssProperty: 'outline-width',
      defaultUnit: 'px', units: ['px'], initial: 0,
    };
    wireMotion(property);
    wireMotion(property);
    const { m } = run('<div data-vera-motion data-vera-motion-twice-over="0% 0px, 100% 2px"></div>');
    expect(reasons(m)).not.toContain('twice-over');
    m.destroy();
  });

  /** Settings too, which are their own map. */
  it('and reports a setting the same way', () => {
    wireMotion({ attribute: 'run-once', type: 'string' });
    const { m } = run('<div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div>');
    expect(reasons(m)).toContain('replaced the "run-once" setting');
    m.destroy();
  });
});

/**
 * The wiring guards added by the 2026-09-01 deep audit: a factory that throws costs the page
 * that module and nothing else, and wiring the same module twice is a no-op for its insert
 * chains as well as its rows — which the clash docblock had promised all along.
 */
describe('wiring stays standing', () => {
  it('a throwing factory is reported and does not take wiring down', () => {
    const before = pageProblems().length;
    wireMotion([
      () => { throw new Error('bad options'); },
      { attribute: 'wire-test-prop', category: 'transform', cssFunction: 'translateX', defaultUnit: 'px', units: ['px'], initial: 0 },
    ]);
    expect(pageProblems().length).toBe(before + 1);
    expect(pageProblems()[before]).toContain('factory threw');
    /** The module after it in the same call still registered. */
    expect(properties().some((p) => p.attribute === 'wire-test-prop')).toBe(true);
  });

  it('wiring the same insert twice registers it once', () => {
    const fn = () => {};
    wireMotion({ on: 'release', fn });
    wireMotion({ on: 'release', fn });
    expect(insert('release').filter((entry) => entry === fn)).toHaveLength(1);
  });
});
