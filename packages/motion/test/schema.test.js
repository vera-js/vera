import { describe, it } from './harness.mjs';
import { expect } from './expect.mjs';
import { parseUrl } from '../src/modules/url.ts';
import { wireMotion, settings as liveSettings } from '../src/modules/schema.ts';
import { paint } from '../src/paint.ts';
import { path, parsePathData } from '../src/path.ts';
import { split as splitModule } from '../src/split.ts';
import { sequence } from '../src/sequence.ts';
import { easings } from '../src/easings.ts';
import {
  PROPERTIES, SETTINGS, PRESETS, UNITS, CATEGORIES,
  MIN_PERCENT, MAX_PERCENT, ATTRIBUTE_PREFIX,
  getProperty, isProperty, isSetting, isPreset,
  parseAttributeName, parseKeyframeList, parseBandedList, parseMeasure, parseSelector,
  parseEasing, parseOrigin, POSITION_UNITS,
} from '../src/modules/schema.ts';

/**
 * Wired here on purpose. `SETTINGS` is the built-in table and stops at the
 * core; the guards below are about every setting the library has, and six of
 * them belong to modules. Wiring does not change `SETTINGS`, which is a
 * constant, so nothing else in this file moves.
 */
wireMotion([paint, path, splitModule, sequence, easings]);

const a = (suffix) => `${ATTRIBUTE_PREFIX}-${suffix}`;

describe('schema invariants', () => {
  it('every property name is unique', () => {
    const names = PROPERTIES.map((p) => p.attribute);
    expect(new Set(names).size).toBe(names.length);
  });

  it('property and setting namespaces are disjoint', () => {
    /** The grammar resolves data-vera-motion-<name> by lookup, so a collision would be ambiguous. */
    for (const setting of SETTINGS) {
      expect(isProperty(setting.attribute)).toBe(false);
    }
    for (const property of PROPERTIES) {
      expect(isSetting(property.attribute)).toBe(false);
    }
  });

  it('every property declares a known category', () => {
    for (const p of PROPERTIES) expect(CATEGORIES).toContain(p.category);
  });

  it('every declared unit is on the allowlist', () => {
    for (const p of PROPERTIES) {
      expect(UNITS).toContain(p.defaultUnit);
      for (const u of p.units) expect(UNITS).toContain(u);
    }
  });

  it('every property names the CSS it drives, or carries its own apply', () => {
    /**
     * A property with no cssFunction, no cssProperty and no `apply` would
     * parse and then silently do nothing. Core has no such property: `frame`
     * was the one exception and it moved to `@verajs/motion/sequence`, where
     * it supplies its own `apply` rather than naming CSS.
     */
    for (const p of PROPERTIES) {
      expect(Boolean(p.cssFunction || p.cssProperty || p.apply), p.attribute).toBe(true);
    }
  });

  /**
   * `start`, `end`, `transform-speed` and `filter-speed` were all declared,
   * parsed, and read by nothing. Two were removed and two were wired up; this
   * keeps the next one from going unnoticed. It is a reminder rather than a
   * proof — the list has to be maintained — but a failing test is a better
   * reminder than a comment.
   */
  /**
   * `position` sat in CATEGORIES with no property in it and no code branching
   * on it. CATEGORIES is public — a GUI deriving its controls from the schema
   * would have rendered an empty group.
   */
  /**
   * Each row must be internally consistent, not merely present. A defaultUnit
   * outside its own units list, or an initial its own parser rejects, would
   * produce an attribute that validates and then behaves oddly.
   */
  it('every property definition is internally consistent', () => {
    const problems = [];
    for (const p of PROPERTIES) {
      if (!p.units.length) problems.push(`${p.attribute}: empty units list`);
      if (!p.units.includes(p.defaultUnit)) {
        problems.push(`${p.attribute}: defaultUnit '${p.defaultUnit}' is not in its own units list`);
      }
      for (const unit of p.units) {
        if (!UNITS.includes(unit)) problems.push(`${p.attribute}: unit '${unit}' is not in UNITS`);
      }
      if (p.min !== undefined && p.max !== undefined && p.min > p.max) {
        problems.push(`${p.attribute}: min > max`);
      }
      if (p.cssFunction && p.cssProperty) {
        problems.push(`${p.attribute}: declares both a cssFunction and a cssProperty`);
      }
      /** Its own resting value must survive its own parser. */
      const round = parseMeasure(String(p.initial), p);
      if (round === null) problems.push(`${p.attribute}: initial ${p.initial} fails parseMeasure`);
      else if (round.value !== p.initial) problems.push(`${p.attribute}: initial round-trips to ${round.value}`);
    }
    expect(problems).toEqual([]);
  });

  it('every setting definition is internally consistent', () => {
    const problems = [];
    for (const s of SETTINGS) {
      if (s.type === 'number' && s.min !== undefined && s.max !== undefined && s.min > s.max) {
        problems.push(`${s.attribute}: min > max`);
      }
      if (s.type === 'string' && !s.allowed) problems.push(`${s.attribute}: string setting with no allowed list`);
      if (s.allowed && !s.allowed.length) problems.push(`${s.attribute}: empty allowed list`);
    }
    expect(problems).toEqual([]);
  });

  /**
   * An exact property name beats a band split, so a property whose name ends
   * in a plausible breakpoint alias shadows that combination. That is the
   * right trade — every documented attribute stays writable — but it is only
   * safe while the precedence holds, which this pins.
   */
  it('resolves an exact property name ahead of a band split', () => {
    const bands = new Map([['x', { min: 0, max: 500 }], ['mobile', { min: 0, max: 640 }]]);
    expect(parseAttributeName(a('rotate-x'), bands)?.property.attribute).toBe('rotate-x');
    expect(parseAttributeName(a('rotate-x'), bands)?.range).toBeNull();
    expect(parseAttributeName(a('rotate-mobile'), bands)?.property.attribute).toBe('rotate');
    expect(parseAttributeName(a('rotate-x-mobile'), bands)?.property.attribute).toBe('rotate-x');
  });

  it('every category has at least one property', () => {
    const used = new Set(PROPERTIES.map((p) => p.category));
    expect(CATEGORIES.filter((c) => !used.has(c)), 'categories with no property').toEqual([]);
  });

  /**
   * A preset is data, and a typo in one of its keyframe strings would parse to
   * nothing and animate nothing, silently. Each is expanded here exactly as
   * the parser would.
   */
  it('every preset expands to animations the parser accepts', () => {
    for (const [name, keyframes] of Object.entries(PRESETS)) {
      const attributes = Object.entries(keyframes);
      expect(attributes.length, `${name} is empty`).toBeGreaterThan(0);
      for (const [attribute, value] of attributes) {
        const property = getProperty(attribute);
        expect(property, `${name} names an unknown property "${attribute}"`).toBeDefined();
        const parsed = parseKeyframeList(String(value), property);
        expect(parsed.rejected, `${name}/${attribute} rejected`).toEqual([]);
        expect(parsed.keyframes.length, `${name}/${attribute} produced no keyframes`)
          .toBeGreaterThan(1);
      }
    }
  });

  /**
   * Both directions, which is the whole fix.
   *
   * This asked only whether every setting is in the list, over `SETTINGS` —
   * so when `split`, `frame-url`, `frame-count`, `frame-pad` and `frame-ext`
   * left the core for their modules, they left `SETTINGS` too and the question
   * stopped being asked about them. Five of the list's twenty entries then
   * named nothing at all, invisibly, and `frame-tween` arrived later and was
   * never asked about either.
   *
   * Deriving consumption from the source was the first attempt and it does not
   * work: `stagger` is read as \`\${ATTRIBUTE_PREFIX}-stagger\`, and the
   * per-category overrides as \`\${category}-inertia\`, so the attribute name
   * never appears anywhere as text. It reported three correct settings as
   * orphans. A hand list is what is left — but a hand list checked in both
   * directions cannot rot silently: a setting moving out of core now fails
   * here instead of quietly leaving the list pointing at nothing.
   */
  it('every declared setting is consumed somewhere, and nothing else is listed', () => {
    const CONSUMED = new Set([
      'inertia', 'inertia-ease', 'transform-inertia', 'filter-inertia', 'ease',
      'run-once', 'when', 'stagger', 'pin', 'perspective', 'will-change', 'transform-origin',
      'path-selector', 'path-rotate',
      /** Module settings — the reason this reads the live registry and not `SETTINGS`. */
      'split', 'frame-url', 'frame-count', 'frame-pad', 'frame-ext', 'frame-tween',
    ]);
    const declared = liveSettings().map((setting) => setting.attribute);

    expect(declared.filter((a) => !CONSUMED.has(a)), 'declared but nothing reads them').toEqual([]);
    expect([...CONSUMED].filter((a) => !declared.includes(a)), 'listed but no longer declared').toEqual([]);
  });

  it('declares pin as a length setting', () => {
    const pin = SETTINGS.find((s) => s.attribute === 'pin');
    expect(pin).toBeDefined();
    expect(pin.type).toBe('length');
  });

  it("each property's initial value is inside its own declared range", () => {
    for (const p of PROPERTIES) {
      if (p.min !== undefined) expect(p.initial).toBeGreaterThanOrEqual(p.min);
      if (p.max !== undefined) expect(p.initial).toBeLessThanOrEqual(p.max);
    }
  });

  it('attribute names are kebab-case', () => {
    for (const p of PROPERTIES) expect(p.attribute).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });
});

describe('parseAttributeName', () => {
  it('reads a property', () => {
    expect(parseAttributeName(a('opacity'))).toMatchObject({ range: null });
    expect(parseAttributeName(a('opacity')).property.attribute).toBe('opacity');
  });

  it('resolves a registered name suffix to its range', () => {
    const names = new Map([['phone', { min: 0, max: 500 }]]);
    const parsed = parseAttributeName(a('translate-y-phone'), names);
    expect(parsed.property.attribute).toBe('translate-y');
    expect(parsed.range).toEqual({ min: 0, max: 500 });
  });

  it('refuses a suffix that is not a registered name', () => {
    expect(parseAttributeName(a('translate-y-phone'), new Map())).toBeNull();
    expect(parseAttributeName(a('translate-y-phone'))).toBeNull();
  });

  it('matches the longest property name, not a prefix', () => {
    expect(parseAttributeName(a('radius-top-left')).property.attribute).toBe('radius-top-left');
  });

  it('resolves the category without it appearing in the attribute', () => {
    expect(parseAttributeName(a('translate-y')).property.category).toBe('transform');
    expect(parseAttributeName(a('blur')).property.category).toBe('filter');
    expect(parseAttributeName(a('radius-top-left')).property.category).toBe('border');
  });

  it.each([
    ['a foreign namespace', 'data-wp-translate-y'],
    ['the old namespace', 'data-oxyani-animate-transform-translate-y-end'],
    ['an unknown property', a('nonsense')],
    ['an unknown suffix', a('translate-y-middle')],
    ['the old keyframe grammar', a('translate-y-at-30')],
    ['the old start grammar', a('translate-y-from')],
    ['the bare marker', ATTRIBUTE_PREFIX],
  ])('rejects %s', (_label, name) => {
    expect(parseAttributeName(name)).toBeNull();
  });
});

describe('parseKeyframeList', () => {
  const translateY = getProperty('translate-y');
  const opacity = getProperty('opacity');
  const rotate = getProperty('rotate');

  it('reads a bare value as the end of the timeline', () => {
    const { keyframes, geometryDependent } = parseKeyframeList('0', opacity);
    expect(keyframes).toEqual([{ position: 100, positionUnit: '%', value: 0, unit: '' }]);
    expect(geometryDependent).toBe(false);
  });

  it('reads a list of position/value pairs', () => {
    const { keyframes } = parseKeyframeList('0% 40px, 60% 0px', translateY);
    expect(keyframes).toMatchObject([
      { position: 0, positionUnit: '%', value: 40, unit: 'px' },
      { position: 60, positionUnit: '%', value: 0, unit: 'px' },
    ]);
  });

  it('tolerates whitespace anywhere the grammar allows it', () => {
    const { keyframes } = parseKeyframeList('  0%   40px ,60%\t0px  ', translateY);
    expect(keyframes).toHaveLength(2);
    expect(keyframes[1]).toMatchObject({ position: 60, value: 0 });
  });

  it('reads plain negative positions, no prefix', () => {
    const { keyframes } = parseKeyframeList('-50% 0, 100% 1', opacity);
    expect(keyframes[0]).toMatchObject({ position: -50, positionUnit: '%' });
  });

  it('allows positions beyond 100, which extrapolate', () => {
    const { keyframes } = parseKeyframeList('0% 0deg, 150% 90deg', rotate);
    expect(keyframes[1]).toMatchObject({ position: 150, positionUnit: '%' });
  });

  it.each(POSITION_UNITS)('accepts %s as a position unit', (unit) => {
    const { keyframes, geometryDependent } = parseKeyframeList(`10${unit} 0, 100% 1`, opacity);
    expect(keyframes[0]).toMatchObject({ position: 10, positionUnit: unit });
    /** Only `%` is already normalised; everything else resolves against geometry. */
    expect(geometryDependent).toBe(unit !== '%');
  });

  it('keeps position and value units independent', () => {
    const { keyframes } = parseKeyframeList('-200px 0deg, 100% 720deg', rotate);
    expect(keyframes[0]).toMatchObject({ position: -200, positionUnit: 'px', value: 0, unit: 'deg' });
  });

  it('respects the declared percentage bounds', () => {
    expect(MIN_PERCENT).toBeLessThan(0);
    expect(MAX_PERCENT).toBeGreaterThan(100);
    expect(parseKeyframeList(`${MAX_PERCENT}% 1`, opacity).keyframes).toHaveLength(1);
    expect(parseKeyframeList(`${MIN_PERCENT}% 1`, opacity).keyframes).toHaveLength(1);
    expect(parseKeyframeList(`${MAX_PERCENT + 1}% 1`, opacity).keyframes).toHaveLength(0);
    expect(parseKeyframeList(`${MIN_PERCENT - 1}% 1`, opacity).keyframes).toHaveLength(0);
  });

  it.each([
    ['a position with no unit', '50 0'],
    ['an unknown position unit', '50em 0'],
    ['a malformed position', 'abc% 0'],
    ['a third token', '0% 1 2'],
    ['an empty entry', ''],
  ])('rejects %s', (_label, raw) => {
    const { keyframes, rejected } = parseKeyframeList(raw, opacity);
    expect(keyframes).toHaveLength(0);
    expect(rejected).toHaveLength(1);
  });

  it('drops one bad entry without losing the rest', () => {
    const { keyframes, rejected } = parseKeyframeList('0% 0, junk junk junk, 100% 1', opacity);
    expect(keyframes).toHaveLength(2);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatch(/^junk junk junk \u2014 ./);
  });

  it('rejects a value the property does not accept, keyframe or not', () => {
    expect(parseKeyframeList('4rem', rotate).keyframes).toHaveLength(0);
    expect(parseKeyframeList('0% 4rem, 100% 90deg', rotate).keyframes).toHaveLength(1);
  });
});

describe('parseMeasure — values', () => {
  const translateY = getProperty('translate-y');
  const opacity = getProperty('opacity');
  const scale = getProperty('scale');

  it('accepts a plain number', () => {
    expect(parseMeasure('100', translateY)?.value).toBe(100);
    expect(parseMeasure('0', translateY)?.value).toBe(0);
    expect(parseMeasure('-40', translateY)?.value).toBe(-40);
  });

  it('accepts decimals, with or without a leading zero', () => {
    expect(parseMeasure('0.5', opacity)?.value).toBe(0.5);
    expect(parseMeasure('.5', opacity)?.value).toBe(0.5);
  });

  it('accepts a value with an allowed unit', () => {
    expect(parseMeasure('100px', translateY)?.value).toBe(100);
    expect(parseMeasure('1.5rem', translateY)?.value).toBe(1.5);
    expect(parseMeasure('50%', translateY)?.value).toBe(50);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseMeasure('  100px  ', translateY)?.value).toBe(100);
  });

  it('rejects a unit the property does not allow', () => {
    expect(parseMeasure('10deg', translateY)).toBeNull();
    expect(parseMeasure('10px', scale)).toBeNull();
  });

  it('rejects values outside the declared range', () => {
    expect(parseMeasure('2', opacity)).toBeNull();      // max 1
    expect(parseMeasure('-0.5', opacity)).toBeNull();   // min 0
    expect(parseMeasure('-1', scale)).toBeNull();       // min 0
  });

  /**
   * Principle #8. Attribute values are untrusted — in a CMS anyone who can
   * edit a block can set them. Nothing resembling a CSS function may survive.
   */
  it.each([
    'calc(100px + 10px)',
    'url(https://evil.example/x.png)',
    'expression(alert(1))',
    'javascript:alert(1)',
    'var(--x)',
    '100px; background: url(//evil.example)',
    '</style><script>alert(1)</script>',
    'attr(data-x)',
    '100px)',
    'translateY(100px)',
    '1e400',
    'Infinity',
    'NaN',
    '',
    '   ',
    '100 200',
    '0x10',
    '+100',
  ])('rejects hostile or malformed input: %j', (hostile) => {
    expect(parseMeasure(hostile, translateY)).toBeNull();
  });
});

describe('parseMeasure — units', () => {
  const translateY = getProperty('translate-y');
  const rotate = getProperty('rotate');

  it('reads an explicit allowed unit', () => {
    expect(parseMeasure('100px', translateY)?.unit).toBe('px');
    expect(parseMeasure('1.5rem', translateY)?.unit).toBe('rem');
    expect(parseMeasure('50%', translateY)?.unit).toBe('%');
  });

  it('falls back to the property default when absent', () => {
    expect(parseMeasure('100', translateY)?.unit).toBe('px');
    expect(parseMeasure('90', rotate)?.unit).toBe('deg');
  });

  /**
   * The wrapper this replaced returned the property's default unit here. That
   * branch was unreachable — the value check rejects a disallowed unit first,
   * so nothing ever asked for the unit of a value that had already failed.
   * Rejecting outright is the behaviour that actually shipped.
   */
  it('rejects a disallowed unit rather than substituting the default', () => {
    expect(parseMeasure('100deg', translateY)).toBeNull();
  });

  it('is unitless where the property is unitless', () => {
    expect(parseMeasure('0.5', getProperty('opacity'))?.unit).toBe('');
    expect(parseMeasure('1.2', getProperty('scale'))?.unit).toBe('');
  });
});

/**
 * Path data ends up inside a quoted CSS `path()`, so a stray quote or
 * parenthesis would break out of it.
 */
describe('parsePathData', () => {
  it.each([
    'M 10 10 L 90 90',
    'M10,10 C20,20 40,20 50,10',
    'm 0 0 h 100 v 100 z',
    'M 1e2 1e2 L 2.5 -3.5',
    '  M 0 0 L 1 1  ',
  ])('accepts the path %j', (d) => {
    expect(parsePathData(d)).toBe(d.trim());
  });

  it.each([
    ['a quote that would close the CSS function', 'M 0 0") ; background: url(//evil.example'],
    ['a parenthesis', 'M 0 0 L 1 1)'],
    ['a url', 'M 0 0 url(x)'],
    ['a CSS function', 'M 0 0 calc(1px)'],
    ['a semicolon', 'M 0 0; color: red'],
    ['a tag', 'M 0 0 </style><script>'],
    ['not starting with a moveto', 'L 10 10'],
    ['empty', ''],
    ['only whitespace', '   '],
  ])('rejects %s', (_label, d) => {
    expect(parsePathData(d)).toBeNull();
  });

  it('rejects an implausibly long path rather than interpolating it', () => {
    expect(parsePathData('M 0 0 ' + 'L 1 1 '.repeat(5000))).toBeNull();
  });
});

describe('bounded input', () => {
  const opacity = getProperty('opacity');

  /**
   * Values were range-checked; counts were not. Measured before this: 200,000
   * keyframes in one attribute parse in 92ms and build a curve that
   * `evaluate` then scans on every frame.
   */
  it('caps how many keyframes one attribute may declare', () => {
    const raw = Array.from({ length: 5000 }, (_, i) => `${i % 100}% 1`).join(', ');
    const { keyframes, rejected } = parseKeyframeList(raw, opacity);
    expect(keyframes.length).toBeLessThanOrEqual(256);
    expect(rejected.some((r) => r.includes('more than'))).toBe(true);
  });

  it('caps how many bands one attribute may declare', () => {
    const bands = Array.from({ length: 500 }, (_, i) => `[${i}-${i + 1}]: 100% 1`).join('; ');
    const { bands: parsed, rejected } = parseBandedList(`0% 0, 100% 1; ${bands}`, opacity);
    expect(parsed.length).toBeLessThanOrEqual(32);
    expect(rejected.some((r) => r.includes('more than'))).toBe(true);
  });

  it('leaves an ordinary keyframe list untouched by the caps', () => {
    const { keyframes, rejected } = parseKeyframeList('0% 0, 50% 0.5, 100% 1', opacity);
    expect(keyframes).toHaveLength(3);
    expect(rejected).toEqual([]);
  });
});

describe('parseEasing', () => {
  /**
   * The value is interpolated into the `transition` shorthand, which takes a
   * comma-separated list — so an unvalidated one can append a second entry.
   * Measured in Chromium before this existed: `"linear, all 9999s linear"`
   * produced a computed `transition-property: filter, all` at 9999s, freezing
   * every animatable property on the element against any later change.
   */
  it.each(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end'])(
    'accepts the keyword %s', (k) => expect(parseEasing(k)).toBe(k));

  it.each([
    'cubic-bezier(0.33, 1, 0.68, 1)',
    'cubic-bezier(0,0,1,1)',
    'cubic-bezier(.4, -0.2, .6, 1.4)',
    'steps(4)',
    'steps(4, end)',
    'steps(2, jump-none)',
  ])('accepts the function %s', (v) => expect(parseEasing(v)).toBe(v));

  it.each([
    ['a second transition entry', 'linear, all 9999s linear'],
    ['a declaration break', 'linear; background: red'],
    ['an unknown keyword', 'not-a-timing-function'],
    ['a bare number', '0.5'],
    ['cubic-bezier with too few arguments', 'cubic-bezier(0, 1, 2)'],
    ['cubic-bezier with a non-number', 'cubic-bezier(0, 1, 2, red)'],
    ['steps with a non-integer', 'steps(1.5)'],
    ['steps with an unknown position', 'steps(4, sideways)'],
    ['a nested function', 'cubic-bezier(var(--x), 1, 1, 1)'],
    ['empty', ''],
  ])('rejects %s', (_label, v) => expect(parseEasing(v)).toBeNull());
});

describe('parseOrigin', () => {
  it.each(['center', 'left top', '50% 50%', '10px 2rem', 'right bottom 4px', '0'])(
    'accepts %s', (v) => expect(parseOrigin(v)).toBe(v));

  it('normalises whitespace rather than passing the raw string through', () => {
    expect(parseOrigin('  left   top  ')).toBe('left top');
  });

  it.each([
    ['a declaration break', 'red; position: fixed; top: 0'],
    ['a url', 'url(https://evil.example/x)'],
    ['a css function', 'calc(100% - 4px)'],
    ['an unknown keyword', 'diagonal'],
    ['too many components', 'left top 4px 8px'],
    ['empty', ''],
  ])('rejects %s', (_label, v) => expect(parseOrigin(v)).toBeNull());
});

describe('settings bounds', () => {
  /**
   * Properties have always been range-checked; settings were not, and an
   * attribute is an attribute. `speed="99999999"` — `inertia` now — reached the
   * DOM as `transition-duration: 1e+08s`.
   *
   * Over `liveSettings()`, not `SETTINGS`. The audit that added these two
   * called them the guards that close the class rather than the instances, and
   * they read the built-in table, so they never saw a setting belonging to a
   * module — including `frame-pad` and `frame-count`, two rows of the very
   * table of hostile values that audit measured. All six pass; the guard could
   * not have told anyone if they did not.
   */
  it('every numeric setting declares both bounds', () => {
    for (const setting of liveSettings()) {
      if (setting.type !== 'number') continue;
      expect(setting.min, `${setting.attribute} min`).toBeTypeOf('number');
      expect(setting.max, `${setting.attribute} max`).toBeTypeOf('number');
      expect(setting.max).toBeGreaterThan(setting.min);
    }
  });

  it('no setting is a bare pass-through string', () => {
    for (const setting of liveSettings()) {
      if (setting.type !== 'string') continue;
      /**
       * A module may bring its own validator instead of an allowlist —
       * `frame-url` is checked against an origin policy, which no list of
       * literals can express. Either is a gate; neither being present is not.
       */
      const gated = setting.allowed !== undefined || typeof setting.parse === 'function';
      expect(gated, `${setting.attribute} needs an allowlist or a parse`).toBe(true);
    }
  });
});

describe('presets', () => {
  it('are recognised by name', () => {
    for (const name of Object.keys(PRESETS)) expect(isPreset(name)).toBe(true);
    expect(isPreset('does-not-exist')).toBe(false);
    expect(isPreset('constructor')).toBe(false);   // no prototype leakage
  });

  it('reference only real properties', () => {
    for (const [preset, keyframes] of Object.entries(PRESETS)) {
      for (const property of Object.keys(keyframes)) {
        expect(isProperty(property), `${preset} -> ${property}`).toBe(true);
      }
    }
  });

  /** A preset must expand to exactly what hand-authored attributes would produce. */
  it('contain only values that pass the same validation as authored ones', () => {
    for (const [preset, keyframes] of Object.entries(PRESETS)) {
      for (const [property, value] of Object.entries(keyframes)) {
        const { keyframes: frames, rejected } = parseKeyframeList(value, getProperty(property));
        expect(rejected, `${preset} ${property} "${value}"`).toEqual([]);
        expect(frames.length, `${preset} ${property}`).toBeGreaterThan(0);
      }
    }
  });

  it('define at least a start and an end for each property they touch', () => {
    for (const keyframes of Object.values(PRESETS)) {
      for (const [property, value] of Object.entries(keyframes)) {
        expect(parseKeyframeList(value, getProperty(property)).keyframes.length)
          .toBeGreaterThanOrEqual(2);
      }
    }
  });
});


/**
 * Audit S1. The old parser handed an attribute value straight to
 * `new Image().src`, so any block editor could make every visitor's browser
 * issue arbitrary outbound requests.
 */
describe('parseUrl', () => {
  const BASE = 'https://example.com/page/';

  it('accepts a same-origin relative url', () => {
    expect(parseUrl('/img/seq/', BASE)).toBe('https://example.com/img/seq/');
    expect(parseUrl('frames/', BASE)).toBe('https://example.com/page/frames/');
  });

  it('accepts a same-origin absolute url', () => {
    expect(parseUrl('https://example.com/img/', BASE)).toBe('https://example.com/img/');
  });

  it('rejects a cross-origin url by default', () => {
    expect(parseUrl('https://evil.example/x/', BASE)).toBeNull();
  });

  it('accepts a cross-origin url only when explicitly allowlisted', () => {
    expect(parseUrl('https://cdn.example.net/x/', BASE, ['https://cdn.example.net']))
      .toBe('https://cdn.example.net/x/');
    expect(parseUrl('https://evil.example/x/', BASE, ['https://cdn.example.net'])).toBeNull();
  });

  it('rejects a protocol-relative url pointing off-origin', () => {
    expect(parseUrl('//evil.example/x/', BASE)).toBeNull();
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    '  javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'blob:https://example.com/abc',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'ftp://example.com/x',
    '',
    '   ',
  ])('rejects the dangerous or unusable scheme %j', (bad) => {
    expect(parseUrl(bad, BASE)).toBeNull();
  });

  it('rejects a different port on the same host — a distinct origin', () => {
    expect(parseUrl('https://example.com:8443/x/', BASE)).toBeNull();
  });

  it('rejects http when the page is https — a distinct origin', () => {
    expect(parseUrl('http://example.com/x/', BASE)).toBeNull();
  });
});

/**
 * The old parser passed this value straight to document.querySelectorAll().
 */
describe('parseSelector', () => {
  /**
   * A selector reaching matches()/querySelector() is parsed, not evaluated —
   * it is not an injection sink. Validation therefore asks the browser's parser
   * rather than policing an alphabet, and refuses only the shapes that cause
   * real trouble.
   */
  it.each([
    '#my-path', '.my-path', 'path', 'svg path', '.wrap > .inner', '#a .b',
    '.a.b', '[aria-expanded="true"]', '[data-state]', 'a:not(.b)', 'input:checked',
    '.card[data-open]', 'li:first-child',
  ])('accepts the valid selector %j', (ok) => {
    expect(parseSelector(ok)).toBe(ok);
  });

  it('trims surrounding whitespace', () => {
    expect(parseSelector('  #my-path  ')).toBe('#my-path');
  });

  it('rejects a selector list — querySelector would take the first match of any', () => {
    expect(parseSelector('a, b')).toBeNull();
    expect(parseSelector('.x,.y')).toBeNull();
  });

  it('rejects :has(), which can be pathological on a large document', () => {
    expect(parseSelector('.card:has(.badge)')).toBeNull();
  });

  it.each([
    ['empty', ''],
    ['only whitespace', '   '],
    ['unparseable', 'a{color:red}'],
    ['an unclosed bracket', '[data-x'],
    ['tag injection', '</style><script>alert(1)</script>'],
    ['absurdly long', 'a'.repeat(201)],
  ])('rejects %s', (_label, bad) => {
    expect(parseSelector(bad)).toBeNull();
  });
});
