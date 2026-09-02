import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { paint } from '../src/paint.ts';
import { easings } from '../src/easings.ts';
import { properties, settings as allSettings } from '../src/modules/schema.ts';

wireMotion([paint, easings]);

/**
 * `restores-the-page.test.js` photographs a page and demands it back. Its page
 * is hand-written, which means it covers the features someone remembered:
 * eleven elements against the registered names, with the radii, the
 * filters beyond `blur`, `path`, `perspective`, `translate-z` and
 * `run-once` all absent.
 *
 * This builds the page from the **live registry** instead — one element per
 * property and one per setting, values derived from each definition's own
 * units and bounds — so a property added tomorrow is covered tomorrow. That is
 * the discipline hand-held lists demand: every drift found so far has
 * been a reader of a static list where the live registry was meant.
 *
 * Two things are asserted, not one. The markup must come back, **and** the
 * property must have written a style in the first place — a generated case
 * that animates nothing would pass the restore check by doing nothing at all.
 */
const P = 'data-vm';

const place = (n) => {
  for (const [k, v] of [['offsetLeft', 100], ['offsetTop', 500], ['offsetWidth', 200], ['offsetHeight', 200]]) {
    Object.defineProperty(n, k, { value: v, configurable: true });
  }
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};

/** A pair of values this property will accept, from its own definition. */
const valuesFor = (property) => {
  /** `paint` carries its own validator and its values are not numbers. */
  if (property.category === 'paint') return ['red', 'blue'];
  const unit = property.defaultUnit ?? '';
  const low = property.min ?? 0;
  const high = property.max ?? low + 1;
  return [`${low}${unit}`, `${Math.min(high, low + 1)}${unit}`];
};

/** A value of the shape this setting's type accepts. */
const settingValue = (setting) => {
  switch (setting.type) {
    case 'number': return String(setting.min ?? 1);
    case 'boolean': return 'true';
    case 'easing': return 'linear';
    case 'selector': return '.on';
    case 'length': return '10px';
    case 'origin': return 'top left';
    case 'offset': return '10%';
    case 'string': return setting.allowed ? setting.allowed[0] : 'x';
    default: return null;
  }
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  document.body.innerHTML = '';
});
afterEach(() => vi.restoreAllMocks());

const photograph = (markup) => {
  document.body.innerHTML = markup;
  for (const node of document.body.children) place(node);
  return document.body.innerHTML;
};

describe('every registered attribute gives the page back', () => {
  it('one element per property, animated and destroyed', () => {
    const problems = [];
    for (const property of properties()) {
      const [from, to] = valuesFor(property);
      const before = photograph(`<div id="t" ${P} ${P}-${property.attribute}="0% ${from}, 100% ${to}"></div>`);
      const m = createMotion({ respectReducedMotion: false, inertia: 0 });
      m.init();
      const wrote = document.getElementById('t').getAttribute('style');
      m.destroy();
      if (document.body.innerHTML !== before) {
        problems.push(`${property.attribute}: ${document.body.innerHTML}`);
      } else if (!wrote) {
        problems.push(`${property.attribute}: wrote no style, so the restore proved nothing`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('one element per setting, with the setting applied', () => {
    const problems = [];
    for (const setting of allSettings()) {
      const value = settingValue(setting);
      if (value === null) {
        problems.push(`${setting.attribute}: type ${setting.type} has no sample value here`);
        continue;
      }
      const before = photograph(
        `<div id="t" ${P} ${P}-opacity="0% 0, 100% 1" ${P}-${setting.attribute}="${value}"></div>`
      );
      const m = createMotion({ respectReducedMotion: false, inertia: 0 });
      m.init();
      m.destroy();
      if (document.body.innerHTML !== before) {
        problems.push(`${setting.attribute}: ${document.body.innerHTML}`);
      }
    }
    expect(problems).toEqual([]);
  });

  /**
   * And an inline style the author wrote, on the very property each animation
   * is about to take over. The runtime owns those declarations while it runs
   * and has to hand them back — a `transform-origin` the author set, a
   * `position: relative` a `pin` replaced with `sticky`.
   */
  it('including an inline style the animation overwrites', () => {
    /**
     * By declaration, not by string. The runtime restores property by property
     * — deliberately, so it does not clobber a declaration something else on
     * the page wrote while it was animating — and the browser serialises them
     * in the order they were set, so the attribute text comes back reordered.
     * With no duplicate properties that is the same style; comparing the text
     * would be asserting the order of a set.
     */
    const declarations = (node) =>
      JSON.stringify(
        (node.getAttribute('style') ?? '')
          .split(';')
          .map((part) => part.trim())
          .filter(Boolean)
          .map((part) => {
            const colon = part.indexOf(':');
            return `${part.slice(0, colon).trim()}: ${part.slice(colon + 1).trim()}`;
          })
          .sort()
      );

    const problems = [];
    for (const property of properties()) {
      if (property.category === 'paint') continue;
      const [from, to] = valuesFor(property);
      const own = 'transform: rotate(45deg); position: relative; will-change: opacity';
      photograph(
        `<div id="t" style="${own}" ${P} ${P}-${property.attribute}="0% ${from}, 100% ${to}"></div>`
      );
      const node = document.getElementById('t');
      const before = declarations(node);
      const m = createMotion({ respectReducedMotion: false, inertia: 0 });
      m.init();
      m.destroy();
      const after = declarations(node);
      if (after !== before) problems.push(`${property.attribute}: ${before} -> ${after}`);
    }
    expect(problems).toEqual([]);
  });
});
