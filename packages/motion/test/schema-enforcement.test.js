/**
 * What the schema declares, the parser enforces — for every property there is.
 *
 * `schema.test.js` sweeps the table for *internal* consistency: names unique,
 * categories known, units on the allowlist, each initial inside its own range.
 * All of that can hold while the parser ignores every one of those
 * declarations. This is the other half — the schema is the single source of
 * truth a GUI generates controls from, so a range it advertises and the parser
 * does not apply is a control that lets someone author something the library
 * will silently drop.
 *
 * Derived from `properties()`, the live registry, rather than `PROPERTIES`, the
 * built-in table — so wired modules are swept too, and a property added later
 * is covered without editing this file. Reading the static table is how the
 * attribute reference came to document 23 of 29, and how `every-property.mjs`
 * came to check the same 23 in a browser.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion, properties, settings } from '../src/index.ts';
import { paint } from '../src/paint.ts';
import { path } from '../src/path.ts';
import { sequence } from '../src/sequence.ts';
import { split } from '../src/split.ts';
import { easings } from '../src/easings.ts';

wireMotion([paint, path, sequence(), split, easings]);

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  /**
   * happy-dom's canvas has no 2D context, so `frame` is refused before its
   * value is ever looked at — which reads, in a sweep like this, as the unit
   * being wrong. This cost twenty passes once;
   * the stub is two lines and neighbouring files already carry it.
   */
  HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {}, globalAlpha: 1 });
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 6000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
});
afterEach(() => vi.restoreAllMocks());

/**
 * Companions a property needs before it can be judged on its own value.
 *
 * Without them the element is refused for a *different* reason — `path` with
 * no `path-selector`, `frame` with no url and `translate-z` with no perspective
 * are all reported, correctly — and
 * a sweep that only asks "was anything rejected" reads that as the unit being
 * wrong. Two properties, named here rather than guessed at, because a silent
 * skip would quietly shrink the sweep.
 */
const COMPANIONS = {
  path: 'data-vm-path-selector="#p"',
  frame: 'data-vm-frame-url="/s/" data-vm-frame-count="10"',
  /**
   * `translateZ()` needs a perspective to project through or it is measured to
   * do nothing, and the runtime reports that at measure time the way it reports
   * a `pin` an ancestor has turned off. Without the companion this sweep reads
   * that diagnostic as the *unit* being refused.
   */
  'translate-z': 'data-vm-perspective="800px"',
};

/** `frame` paints a canvas and is refused on anything else — correctly. */
const ELEMENT = { frame: 'canvas' };

/** Whether the parser refused this value for this attribute. */
const refuses = (attribute, value) => {
  document.body.innerHTML =
    '<svg width="0" height="0"><path id="p" d="M0,0 L10,10"></path></svg>' +
    `<${ELEMENT[attribute] ?? 'div'} data-vm ${COMPANIONS[attribute] ?? ''} ` +
    `data-vm-${attribute}="0% ${value}, 100% ${value}"></${ELEMENT[attribute] ?? 'div'}>`;
  const m = createMotion({ respectReducedMotion: false });
  m.init();
  const rejected = m.rejected.map((r) => r.rejected).flat();
  m.destroy();
  return rejected.length > 0;
};

/** Properties whose own `parse` decides — paint asks the engine instead. */
const numeric = () => properties().filter((p) => !p.parse);

const UNITS = ['px', 'deg', '%', 'rem', 'vh', 's'];

describe('units', () => {
  it('a unit a property does not declare is refused, for every property', () => {
    const accepted = [];
    for (const property of numeric()) {
      const alien = UNITS.find((unit) => !property.units.includes(unit));
      if (!alien) continue;
      if (!refuses(property.attribute, `1${alien}`)) {
        accepted.push(`${property.attribute} accepted 1${alien}, declaring ${JSON.stringify(property.units)}`);
      }
    }
    expect(accepted).toEqual([]);
  });

  /** Without this the sweep above passes for a parser that refuses everything. */
  it('and a unit it does declare is accepted', () => {
    const refused = [];
    for (const property of numeric()) {
      const own = property.units.find(Boolean) ?? '';
      const inRange = property.min ?? 0;
      if (refuses(property.attribute, `${inRange}${own}`)) {
        refused.push(`${property.attribute} refused ${inRange}${own}, declaring ${JSON.stringify(property.units)}`);
      }
    }
    expect(refused).toEqual([]);
  });
});

describe('ranges', () => {
  it('a value past a declared maximum is refused, for every property that has one', () => {
    const accepted = [];
    for (const property of numeric()) {
      if (property.max === undefined) continue;
      const over = `${property.max + 1000}${property.defaultUnit}`;
      if (!refuses(property.attribute, over)) {
        accepted.push(`${property.attribute} accepted ${over}, max ${property.max}`);
      }
    }
    expect(accepted).toEqual([]);
  });

  it('and a value below a declared minimum', () => {
    const accepted = [];
    for (const property of numeric()) {
      if (property.min === undefined) continue;
      const under = `${property.min - 1000}${property.defaultUnit}`;
      if (!refuses(property.attribute, under)) {
        accepted.push(`${property.attribute} accepted ${under}, min ${property.min}`);
      }
    }
    expect(accepted).toEqual([]);
  });
});

describe('the sweep itself', () => {
  /**
   * A conformance sweep that swept nothing would pass every assertion above.
   * The count is the guard, and it is deliberately a lower bound rather than
   * an exact number so adding a property does not fail this file.
   */
  it('covers the whole registry, not the built-in table', () => {
    expect(properties().length).toBeGreaterThan(24);
    expect(numeric().length).toBeGreaterThan(20);
    expect(properties().map((p) => p.attribute)).toContain('frame');
  });
});

/**
 * And the other half of the vocabulary.
 *
 * Everything above sweeps *properties*. Settings had no sweep at all, which is
 * the same asymmetry an earlier audit found — "property values had
 * been range-checked since the rewrite; settings had never been checked at
 * all". That audit fixed the instances and added two tests that check the
 * schema *declares* bounds. Declaring is not enforcing: this file exists
 * because "all of that can hold while the parser ignores every one of those
 * declarations", and for settings nothing asked.
 *
 * Every setting the live registry holds is enforced today. This is what keeps
 * it that way for the next one added.
 */
describe('settings', () => {
  /**
   * How to write something invalid, per type. Named rather than guessed, and
   * a type absent from here fails the sweep below rather than being skipped —
   * a completeness check that quietly ignores what it does not understand is
   * the failure this whole file was written against.
   */
  const NONSENSE = {
    length: 'not-a-length',
    easing: 'not-an-easing',
    selector: '###',
    offset: 'not-an-offset',
    origin: 'red; position: fixed',
    /** A url outside the origin policy — the only invalid `string` shape that is not an allowlist miss. */
    string: 'https://evil.test/x/',
    /** A bare attribute is true and anything else is a value; there is no invalid boolean. */
    boolean: null,
    number: null,
  };

  const refusesSetting = (attribute, value) => {
    document.body.innerHTML =
      '<canvas data-vm data-vm-opacity="0% 0, 100% 1" ' +
      `data-vm-${attribute}="${value}"></canvas>`;
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    const reasons = m.rejected.flatMap((r) => r.rejected);
    m.destroy();
    return reasons.some((reason) => reason.includes(attribute));
  };

  it('knows how to write an invalid value for every type in the registry', () => {
    const unknown = [...new Set(settings().map((setting) => setting.type))]
      .filter((type) => !(type in NONSENSE));
    expect(unknown, 'setting types this sweep cannot test').toEqual([]);
  });

  it('refuses a number past its declared maximum, for every numeric setting', () => {
    const accepted = [];
    for (const setting of settings()) {
      if (setting.type !== 'number' || typeof setting.max !== 'number') continue;
      const over = setting.max + Math.max(1, Math.abs(setting.max));
      if (!refusesSetting(setting.attribute, over)) accepted.push(`${setting.attribute}=${over}`);
    }
    expect(accepted, 'past the declared maximum and accepted').toEqual([]);
  });

  it('and below its declared minimum', () => {
    const accepted = [];
    for (const setting of settings()) {
      if (setting.type !== 'number' || typeof setting.min !== 'number') continue;
      const under = setting.min - Math.max(1, Math.abs(setting.min));
      if (!refusesSetting(setting.attribute, under)) accepted.push(`${setting.attribute}=${under}`);
    }
    expect(accepted, 'below the declared minimum and accepted').toEqual([]);
  });

  it('refuses a value that is not on the allowlist, for every setting that has one', () => {
    const accepted = [];
    for (const setting of settings()) {
      if (!setting.allowed) continue;
      if (!refusesSetting(setting.attribute, 'zzz-not-a-value')) accepted.push(setting.attribute);
    }
    expect(accepted, 'off the allowlist and accepted').toEqual([]);
  });

  it('refuses nonsense for every setting whose type carries its own validator', () => {
    const accepted = [];
    for (const setting of settings()) {
      if (setting.allowed) continue;
      const bad = NONSENSE[setting.type];
      if (bad === null || bad === undefined) continue;
      if (!refusesSetting(setting.attribute, bad)) accepted.push(`${setting.attribute}="${bad}"`);
    }
    expect(accepted, 'nonsense accepted').toEqual([]);
  });
});

/**
 * A module `parse` that breaks its `number | null` contract must land as the
 * standard refusal, not as a silent shape: NaN flowed through the curve into
 * a style write, a literal `NaN` token reached custom properties (which real
 * engines accept and hand to `var()` consumers), and a string return was
 * coerced to NaN by the plan's typed arrays.
 */
describe('a module parse that breaks the number-or-null contract', () => {
  it.each([['NaN', () => NaN], ['Infinity', () => Infinity], ['a string', () => '20px); position:fixed; (']])(
    'refuses %s instead of letting it through', (label, parse) => {
      const attr = 'contract-' + label.replace(/[^a-z]/gi, '').toLowerCase();
      wireMotion([{ attribute: attr, category: 'weird', cssProperty: '--' + attr, defaultUnit: '', units: [''], initial: 0, parse }]);
      document.body.innerHTML =
        '<div data-vm data-vm-' + attr + '="x"></div>';
      const node = document.body.firstElementChild;
      for (const [k, v] of [['offsetTop', 500], ['offsetHeight', 100], ['offsetParent', null]]) {
        Object.defineProperty(node, k, { value: v, configurable: true });
      }
      const m = createMotion({ respectReducedMotion: false, inertia: 0 });
      m.init();
      expect(node.style.cssText, 'nothing written').toBe('');
      expect(m.rejected.flatMap((r) => r.rejected).join('|'), 'and it is said').toContain(attr);
      m.destroy();
    });
});

