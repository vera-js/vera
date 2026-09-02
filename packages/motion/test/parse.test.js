import { describe, it, beforeEach } from './harness.mjs';
import { expect } from './expect.mjs';
import { sequence } from '../src/sequence.ts';
import { path } from '../src/path.ts';
import { wireMotion } from '../src/index.ts';
import { parseElement, parseAll, findElements } from '../src/modules/parse.ts';

/**
 * Curves are built by the runtime, because a position in `vh` or `px` only
 * means something once the element has been measured. Parse tests therefore
 * assert the keyframes the runtime will build from — see runtime.test.js for
 * the curves themselves.
 */
wireMotion([sequence, path]);

const frames = (a) => a.keyframes.map((k) => [`${k.position}${k.positionUnit}`, k.value]);

const ORIGIN = 'https://example.com/page/';
const ctx = (over = {}) => ({ origin: ORIGIN, ...over });

const el = (html) => {
  document.body.innerHTML = html;
  return document.body.firstElementChild;
};

const animationFor = (parsed, property) =>
  parsed.animations.find((a) => a.property.attribute === property);

beforeEach(() => { document.body.innerHTML = ''; });

describe('findElements', () => {
  it('finds only marked elements', () => {
    document.body.innerHTML = `
      <div data-vera-motion data-vera-motion-opacity="0"></div>
      <div data-vera-motion-opacity="0"></div>
      <div></div>`;
    expect(findElements(document)).toHaveLength(1);
  });
});

describe('parseElement — the grammar', () => {
  /**
   * Parse keeps the keyframes as authored. Filling a lone one from the
   * property's resting value moved to the runtime, because a width band can
   * supply the end the base was missing — so the fill has to happen after the
   * merge, not before it. `runtime.test.js` covers the filled result.
   */
  it('reads a bare value as the end of the timeline', () => {
    const parsed = parseElement(el('<div data-vera-motion data-vera-motion-opacity="0"></div>'), ctx());
    expect(frames(animationFor(parsed, 'opacity'))).toEqual([['100%', 0]]);
  });

  /**
   * A single keyframe is ambiguous, and the missing end is filled from the
   * property's resting value — in *both* directions. Only filling the start
   * left a lone start value pinning the element there forever, which for
   * opacity means invisible.
   */
  it('keeps a lone start keyframe as authored', () => {
    const parsed = parseElement(el('<div data-vera-motion data-vera-motion-opacity="0% 0"></div>'), ctx());
    expect(frames(animationFor(parsed, 'opacity'))).toEqual([['0%', 0]]);
  });

  it('reads a two-keyframe list', () => {
    const parsed = parseElement(
      el('<div data-vera-motion data-vera-motion-translate-y="0% 40px, 100% 0px"></div>'), ctx());
    const a = animationFor(parsed, 'translate-y');
    expect(frames(a)).toEqual([['0%', 40], ['100%', 0]]);
    expect(a.unit).toBe('px');
  });

  it('reads keyframes with no cap on how many', () => {
    const parsed = parseElement(el(`<div data-vera-motion
      data-vera-motion-translate-y="0% 0, 20% 80, 40% 20, 60% 90, 80% 10, 100% 100"></div>`), ctx());
    /** The old model capped at four. */
    expect(frames(animationFor(parsed, 'translate-y'))).toHaveLength(6);
  });

  it('reads a plain negative keyframe', () => {
    const parsed = parseElement(
      el('<div data-vera-motion data-vera-motion-opacity="-50% 0, 100% 1"></div>'), ctx());
    expect(frames(animationFor(parsed, 'opacity'))).toEqual([['-50%', 0], ['100%', 1]]);
  });

  it('carries a geometry-dependent position through untouched', () => {
    const parsed = parseElement(
      el('<div data-vera-motion data-vera-motion-opacity="-30vh 0, 100% 1"></div>'), ctx());
    const a = animationFor(parsed, 'opacity');
    expect(frames(a)).toEqual([['-30vh', 0], ['100%', 1]]);
    expect(a.geometryDependent).toBe(true);
  });

  it('leaves a percentage-only animation geometry-free', () => {
    const parsed = parseElement(el('<div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div>'), ctx());
    expect(animationFor(parsed, 'opacity').geometryDependent).toBe(false);
  });

  it('derives the category without it appearing in the attribute', () => {
    const parsed = parseElement(el(`<div data-vera-motion
      data-vera-motion-translate-y="10px" data-vera-motion-blur="4px" data-vera-motion-radius-top-left="8px"></div>`), ctx());
    expect(animationFor(parsed, 'translate-y').property.category).toBe('transform');
    expect(animationFor(parsed, 'blur').property.category).toBe('filter');
    expect(animationFor(parsed, 'radius-top-left').property.category).toBe('border');
  });

  it('takes the unit from the value, not a separate attribute', () => {
    const parsed = parseElement(el('<div data-vera-motion data-vera-motion-translate-y="1.5rem"></div>'), ctx());
    expect(animationFor(parsed, 'translate-y').unit).toBe('rem');
  });

  it('falls back to the property default unit', () => {
    const parsed = parseElement(el('<div data-vera-motion data-vera-motion-rotate="90"></div>'), ctx());
    expect(animationFor(parsed, 'rotate').unit).toBe('deg');
  });

  it('drops one bad keyframe rather than the whole property', () => {
    const parsed = parseElement(
      el('<div data-vera-motion data-vera-motion-opacity="0% 0, garbage, 100% 1"></div>'), ctx());
    expect(frames(animationFor(parsed, 'opacity'))).toEqual([['0%', 0], ['100%', 1]]);
    /**
     * The entry *and* why it went. A refusal used to be the raw text alone —
     * `opacity: 0% 2` with no hint that opacity stops at 1 — which is what a
     * GUI editor renders beside a misspelt attribute's full sentence.
     */
    expect(parsed.rejected.some((r) => r.startsWith('opacity: garbage'))).toBe(true);
    expect(parsed.rejected.join(' ')).toMatch(/not a value this property can use/);
  });

  it('returns null when nothing valid is found', () => {
    expect(parseElement(el('<div data-vera-motion></div>'), ctx())).toBeNull();
    expect(parseElement(el('<div data-vera-motion data-vera-motion-nonsense="5"></div>'), ctx())).toBeNull();
    expect(parseElement(el('<div data-vera-motion data-vera-motion-opacity="nope"></div>'), ctx())).toBeNull();
  });
});

describe('parseElement — width bands', () => {
  /**
   * Bands are the primitive. A `-name` suffix is an alias the instance
   * registered for a range, so nothing past this point ever sees a name.
   */
  const named = { breakpoints: new Map([['mobile', { min: 0, max: 640 }]]) };

  it('reads an inline range', () => {
    const parsed = parseElement(
      el('<div data-vera-motion data-vera-motion-translate-y="0% 0px, 100% 100px; [0-500]: 100% 20px"></div>'), ctx());
    const a = animationFor(parsed, 'translate-y');
    expect(frames(a)).toEqual([['0%', 0], ['100%', 100]]);
    expect(a.bands).toHaveLength(1);
    expect(a.bands[0]).toMatchObject({ min: 0, max: 500 });
  });

  it('reads an open-ended range', () => {
    const parsed = parseElement(
      el('<div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1; [900+]: 100% 0.5"></div>'), ctx());
    expect(animationFor(parsed, 'opacity').bands[0]).toMatchObject({ min: 900, max: Infinity });
  });

  it('refuses junk between the range and its colon rather than shrugging', () => {
    /** `[0-500]x:` used to apply the band as if clean — the junk simply vanished (2026-09-01). */
    const parsed = parseElement(
      el('<div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1; [0-500]x: 100% 0.5"></div>'), ctx());
    const a = animationFor(parsed, 'opacity');
    expect(a.bands).toHaveLength(0);
    expect(parsed.rejected.join(' ')).toContain('[0-500]x');
  });

  it('reads several bands from one attribute', () => {
    const parsed = parseElement(el(`<div data-vera-motion
      data-vera-motion-opacity="0% 0, 100% 1; [0-500]: 100% 0.5; [501-900]: 100% 0.8"></div>`), ctx());
    expect(animationFor(parsed, 'opacity').bands.map((b) => [b.min, b.max]))
      .toEqual([[0, 500], [501, 900]]);
  });

  it('resolves a registered name to the range it stands for', () => {
    const parsed = parseElement(el(`<div data-vera-motion
      data-vera-motion-translate-y="100px" data-vera-motion-translate-y-mobile="20px"></div>`), ctx(named));
    const a = animationFor(parsed, 'translate-y');
    expect(a.bands).toHaveLength(1);
    expect(a.bands[0]).toMatchObject({ min: 0, max: 640 });
    expect(a.bands[0].keyframes[0]).toMatchObject({ position: 100, value: 20 });
  });

  it('ignores a name the instance never registered', () => {
    const parsed = parseElement(el(`<div data-vera-motion
      data-vera-motion-translate-y="100px" data-vera-motion-translate-y-nonsense="20px"></div>`), ctx(named));
    expect(animationFor(parsed, 'translate-y').bands).toHaveLength(0);
  });

  it('rejects a malformed range rather than guessing', () => {
    const parsed = parseElement(
      el('<div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1; [500-100]: 100% 0"></div>'), ctx());
    expect(parsed.rejected.some((r) => r.includes('500-100'))).toBe(true);
    expect(animationFor(parsed, 'opacity').bands).toHaveLength(0);
  });

  it('marks the animation geometry-dependent if any band position is', () => {
    const parsed = parseElement(
      el('<div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1; [0-500]: 50vh 0.5"></div>'), ctx());
    expect(animationFor(parsed, 'opacity').geometryDependent).toBe(true);
  });
});

describe('parseElement — stagger', () => {
  const grid = (attrs, count = 3) => {
    document.body.innerHTML =
      `<div ${attrs}>${'<div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div>'.repeat(count)}</div>`;
    return [...document.querySelectorAll('[data-vera-motion]')].map((n) => parseElement(n, ctx()));
  };

  it('offsets each child by its index, leaving the first alone', () => {
    const [a, b, c] = grid('data-vera-motion-stagger="8"');
    expect(a.stagger).toBeUndefined();
    expect(b.stagger).toEqual({ position: 8, positionUnit: '%' });
    expect(c.stagger).toEqual({ position: 16, positionUnit: '%' });
  });

  it('defaults to percent, the unit keyframe positions use most', () => {
    expect(grid('data-vera-motion-stagger="8"')[1].stagger.positionUnit).toBe('%');
  });

  it.each(['%', 'vh', 'vw', 'px', 'rem'])('accepts an explicit %s', (unit) => {
    const [, second] = grid(`data-vera-motion-stagger="10${unit}"`);
    expect(second.stagger).toEqual({ position: 10, positionUnit: unit });
  });

  it('leaves elements alone when no ancestor staggers', () => {
    expect(grid('class="plain"')[1].stagger).toBeUndefined();
  });

  /**
   * `parentElement` first: a container that animates *and* staggers its
   * children must not stagger itself by its own index.
   */
  it('does not stagger the staggering element itself, and does not count it', () => {
    document.body.innerHTML = `<div data-vera-motion data-vera-motion-stagger="8" data-vera-motion-opacity="0% 0, 100% 1">
      <div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div>
      <div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div></div>`;
    const [host, first, second] =
      [...document.querySelectorAll('[data-vera-motion]')].map((n) => parseElement(n, ctx()));
    expect(host.stagger).toBeUndefined();
    /** The sequence is the descendants, indexed from zero — the host is not in it. */
    expect(first.stagger).toBeUndefined();
    expect(second.stagger).toEqual({ position: 8, positionUnit: '%' });
  });

  it('accepts a negative step, so a row can arrive in reverse', () => {
    expect(grid('data-vera-motion-stagger="-8"')[2].stagger).toEqual({ position: -16, positionUnit: '%' });
  });

  it('reports a malformed step rather than guessing at it', () => {
    const [, second] = grid('data-vera-motion-stagger="soon"');
    expect(second.rejected.join(' | ')).toContain('data-vera-motion-stagger');
    expect(second.stagger).toBeUndefined();
  });

  it('range-checks the step like any other position', () => {
    expect(grid('data-vera-motion-stagger="999999"')[1].stagger).toBeUndefined();
  });

  it('applies through a nesting level, not just to direct children', () => {
    document.body.innerHTML = `<div data-vera-motion-stagger="5">
      <div class="wrap"><div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div></div>
      <div class="wrap"><div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div></div></div>`;
    const parsed = [...document.querySelectorAll('[data-vera-motion]')].map((n) => parseElement(n, ctx()));
    expect(parsed[1].stagger).toEqual({ position: 5, positionUnit: '%' });
  });
});

describe('parseElement — presets', () => {
  it('expands a preset named on the marker', () => {
    const parsed = parseElement(el('<div data-vera-motion="fade-up"></div>'), ctx());
    expect(frames(animationFor(parsed, 'opacity'))).toEqual([['0%', 0], ['100%', 1]]);
    expect(frames(animationFor(parsed, 'translate-y'))).toEqual([['0%', 40], ['100%', 0]]);
  });

  it('lets an explicit attribute replace the preset for that property', () => {
    const parsed = parseElement(
      el('<div data-vera-motion="fade-up" data-vera-motion-translate-y="0% 200px, 100% 0px"></div>'), ctx());
    expect(frames(animationFor(parsed, 'translate-y'))).toEqual([['0%', 200], ['100%', 0]]);
    /** opacity, untouched, still comes from the preset */
    expect(frames(animationFor(parsed, 'opacity'))).toEqual([['0%', 0], ['100%', 1]]);
  });

  it('records an unknown preset as rejected rather than guessing', () => {
    const parsed = parseElement(el('<div data-vera-motion="not-a-preset" data-vera-motion-opacity="0"></div>'), ctx());
    /** A sentence, not a bare name — same contract as every other refusal (2026-09-01). */
    expect(parsed.rejected.join(' ')).toContain('data-vera-motion="not-a-preset"');
    expect(parsed.rejected.join(' ')).toContain('not a preset');
    expect(animationFor(parsed, 'opacity')).toBeDefined();
  });
});


describe('parseElement — pinning', () => {
  it('reads a pin length with an explicit unit', () => {
    const parsed = parseElement(
      el('<div data-vera-motion data-vera-motion-opacity="0" data-vera-motion-pin="120px"></div>'), ctx());
    expect(parsed.settings.pin).toBe('120px');
  });

  it('defaults a bare number to px', () => {
    const parsed = parseElement(
      el('<div data-vera-motion data-vera-motion-opacity="0" data-vera-motion-pin="80"></div>'), ctx());
    expect(parsed.settings.pin).toBe('80px');
  });

  it('accepts other length units', () => {
    const parsed = parseElement(
      el('<div data-vera-motion data-vera-motion-opacity="0" data-vera-motion-pin="10vh"></div>'), ctx());
    expect(parsed.settings.pin).toBe('10vh');
  });

  it.each(['calc(10px + 2px)', 'auto', 'url(x)', '10 20', ''])('rejects %j', (bad) => {
    const parsed = parseElement(
      el(`<div data-vera-motion data-vera-motion-opacity="0" data-vera-motion-pin="${bad}"></div>`), ctx());
    expect(parsed.settings.pin).toBeUndefined();
  });
});

describe('parseElement — settings', () => {
  it('reads a numeric setting', () => {
    const parsed = parseElement(el('<div data-vera-motion data-vera-motion-opacity="0" data-vera-motion-inertia="2"></div>'), ctx());
    expect(parsed.settings.inertia).toBe(2);
  });

  it('reads a bare boolean attribute as true', () => {
    const parsed = parseElement(el('<div data-vera-motion data-vera-motion-opacity="0" data-vera-motion-run-once></div>'), ctx());
    expect(parsed.settings['run-once']).toBe(true);
  });

  it('reads an explicit boolean', () => {
    const parsed = parseElement(el('<div data-vera-motion data-vera-motion-opacity="0" data-vera-motion-run-once="false"></div>'), ctx());
    expect(parsed.settings['run-once']).toBe(false);
  });

  it('rejects a non-numeric value for a numeric setting', () => {
    const parsed = parseElement(el('<div data-vera-motion data-vera-motion-opacity="0" data-vera-motion-inertia="fast"></div>'), ctx());
    expect(parsed.settings.inertia).toBeUndefined();
    expect(parsed.rejected.join(' | ')).toContain('data-vera-motion-inertia');
  });
});

describe('parseElement — settings are range-checked like values', () => {
  const settingsOf = (attrs) =>
    parseElement(el(`<div data-vera-motion data-vera-motion-opacity="0" ${attrs}></div>`), ctx());

  /**
   * Name **and** reason. Every one of these used to assert the bare attribute
   * name, because that is all a refused setting put in the list — a GUI
   * rendering `rejected` showed `data-vera-motion-when` and nothing else, while
   * the README calls this array "reasons" and sends anyone whose element is not
   * animating to read it. Asserting only the name would leave the sentence
   * untested and free to rot.
   */
  it.each([
    ['inertia above the ceiling', 'data-vera-motion-inertia="99999999"',
      'data-vera-motion-inertia', 'must be a number from 0 to'],
    ['negative inertia', 'data-vera-motion-inertia="-5"',
      'data-vera-motion-inertia', 'must be a number from 0 to'],
    ['frames above the ceiling', 'data-vera-motion-frame-count="1000000000"',
      'data-vera-motion-frame-count', 'must be a number from'],
    ['a frame-pad that would allocate megabytes', 'data-vera-motion-frame-pad="10000000"',
      'data-vera-motion-frame-pad', 'must be a number from'],
    ['an injected second transition', 'data-vera-motion-ease="linear, all 9999s linear"',
      'data-vera-motion-ease', 'is not an easing name or a cubic-bezier()'],
    ['a transform-origin that is not one', 'data-vera-motion-transform-origin="red; position: fixed"',
      'data-vera-motion-transform-origin', 'is not a transform-origin'],
  ])('rejects %s and reports it', (_label, attr, named, why) => {
    const parsed = settingsOf(attr);
    const said = parsed.rejected.join(' | ');
    expect(said).toContain(named);
    expect(said, 'the name alone is not a reason').toContain(why);
    /** Dropped entirely, so the instance default applies rather than the hostile value. */
    expect(Object.keys(parsed.settings)).toHaveLength(0);
  });

  it.each([
    ['speed', 'data-vera-motion-inertia="0.4"', { inertia: 0.4 }],
    ['inertia of 0, which means track exactly', 'data-vera-motion-inertia="0"', { inertia: 0 }],
    ['ease', 'data-vera-motion-ease="ease-in-out"', { ease: 'ease-in-out' }],
    ['a bezier ease', 'data-vera-motion-ease="cubic-bezier(0.33, 1, 0.68, 1)"', { ease: 'cubic-bezier(0.33, 1, 0.68, 1)' }],
    ['transform-origin', 'data-vera-motion-transform-origin="50% 50%"', { 'transform-origin': '50% 50%' }],
    ['frames', 'data-vera-motion-frame-count="240"', { 'frame-count': 240 }],
  ])('still accepts %s', (_label, attr, expected) => {
    const parsed = settingsOf(attr);
    expect(parsed.settings).toMatchObject(expected);
    expect(parsed.rejected).toEqual([]);
  });
});

/** Audit S1 — the reason this parser exists in this shape. */
describe('parseElement — security', () => {
  it('parses an image-sequence animation', () => {
    const parsed = parseElement(el(`<canvas data-vera-motion
      data-vera-motion-frame="0% 0, 100% 240"
      data-vera-motion-frame-url="/seq/" data-vera-motion-frame-count="240"></canvas>`), ctx());
    expect(animationFor(parsed, 'frame')).toBeDefined();
    /** The module resolves against the page origin, not the parse context's. */
    expect(parsed.settings['frame-url']).toBe(`${window.location.origin}/seq/`);
    expect(parsed.settings['frame-count']).toBe(240);
  });

  it('accepts path now that offset-path drives it', () => {
    const parsed = parseElement(
      el('<div data-vera-motion data-vera-motion-path="0% 0, 100% 100" data-vera-motion-path-selector="#route"></div>'),
      ctx());
    const a = animationFor(parsed, 'path');
    expect(a.property.cssProperty).toBe('offset-distance');
    expect(a.unit).toBe('%');
    expect(parsed.settings['path-selector']).toBe('#route');
  });

  it.each(['calc(100px + 1px)', 'url(//evil.example)', 'expression(1)', 'var(--x)', '100px;color:red'])(
    'drops the hostile value %j and leaves the element unanimated', (bad) => {
      const parsed = parseElement(el(`<div data-vera-motion data-vera-motion-translate-y="${bad}"></div>`), ctx());
      expect(parsed).toBeNull();
    });

  it('drops only the bad value when others are valid', () => {
    const parsed = parseElement(
      el('<div data-vera-motion data-vera-motion-opacity="0" data-vera-motion-translate-y="calc(1px)"></div>'), ctx());
    expect(animationFor(parsed, 'opacity')).toBeDefined();
    expect(animationFor(parsed, 'translate-y')).toBeUndefined();
  });

  it('ignores foreign data attributes entirely', () => {
    const parsed = parseElement(el(`<div data-vera-motion data-vera-motion-opacity="0"
      data-wp-interactive="x" data-oxyani-animate-transform-translate-y-end="9"></div>`), ctx());
    expect(parsed.animations).toHaveLength(1);
    expect(parsed.rejected).toHaveLength(0);
  });
});

describe('parseAll', () => {
  it('parses every marked element and skips unparseable ones', () => {
    document.body.innerHTML = `
      <div data-vera-motion data-vera-motion-opacity="0"></div>
      <div data-vera-motion></div>
      <div data-vera-motion="fade"></div>
      <div data-vera-motion-opacity="0"></div>`;
    expect(parseAll(ctx(), document)).toHaveLength(2);
  });
});
