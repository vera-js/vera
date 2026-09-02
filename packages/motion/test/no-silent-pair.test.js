import { readdirSync } from 'node:fs';
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion, settings as registered } from '../src/index.ts';
import { easings } from '../src/easings.ts';
import { paint } from '../src/paint.ts';
import { path } from '../src/path.ts';
import { split } from '../src/split.ts';
import { sequence } from '../src/sequence.ts';

/**
 * Every module, so the completeness check below sees every setting there is —
 * `split` and the four `frame-*` settings exist only once their module is
 * wired, and a matrix that could not see them would excuse them by accident.
 */
wireMotion([easings, paint, path, split, sequence]);

/**
 * **No setting may be silently inert beside another.**
 *
 * This library has rediscovered that failure four times, one pair at a time:
 * `ease` did nothing at `inertia: 0`; `transform-inertia` and `filter-inertia`
 * were declared, parsed and then read by nobody; `stagger` did nothing on a
 * state-driven element; and `delay` did nothing at all, which is why it was
 * removed. Each was found by tripping over it.
 *
 * So this asks every setting what it does beside every other and reads the
 * whole table. The invariant is not "every pair works" — some genuinely cannot,
 * and `ease` beside `when` is one — it is that **inert and silent never happen
 * together**. A pair that cannot work must say so in `rejected`.
 *
 * The negative result is the point: 45 pairs, and the three that could plausibly
 * have gone quiet (`inertia-ease`, `transform-inertia`, `filter-inertia` beside
 * `when`) are confirmed to work rather than assumed to.
 */
const P = 'data-vera-motion';

const place = (node) => {
  for (const [key, value] of [['offsetTop', 1000], ['offsetHeight', 200], ['offsetWidth', 200]]) {
    Object.defineProperty(node, key, { value, configurable: true });
  }
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  /** `setTransitions` defers by a frame, so the transition lands only if one runs. */
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 9000, configurable: true });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const build = (attrs, scrollY) => {
  document.body.innerHTML =
    `<div class="on" ${P} ${attrs} ${P}-translate-y="0% 0px, 100% 100px" ` +
    /** Both categories, or a per-category inertia has nothing to be a duration for. */
    `${P}-opacity="0% 0, 100% 1"></div>`;
  const node = document.body.firstElementChild;
  place(node);
  Object.defineProperty(window, 'scrollY', { value: scrollY, configurable: true });
  const m = createMotion({ respectReducedMotion: false, inertia: 0.2 });
  m.init();
  return { node, m };
};

/**
 * A value for each setting, distinctive enough that its effect cannot coincide
 * with the default or with another's: the durations differ from each other and
 * from the instance's, and `ease-out` is not a substring of the default
 * `cubic-bezier(…)`.
 *
 * There are no hand-written "did it work" predicates. The first version of this
 * file had them and they were wrong in exactly the place that mattered: the
 * probe for `ease` asked whether the transform had moved off the straight line,
 * and `when` moves it for its own reason — so `ease` beside `when` read as
 * working, which is the defect this whole sweep was written after. A predicate
 * is a second implementation of the thing being tested (a check that re-implements its subject can only agree with it).
 *
 * What replaces it is a **difference**: build the pair, build the pair without
 * this setting, and compare what the runtime wrote. A setting that changes
 * nothing did nothing, whatever anyone believed it should do.
 *
 * **What this cannot see: one value per setting.** A setting that is inert only
 * at a *particular* value is invisible here, and there is a real one —
 * `inertia-ease` does nothing at `inertia: 0`, because there is no transition
 * for it to shape, and the value below is not 0. That pair is covered in
 * `ease-and-when.test.js` instead. Widening this to two values per setting
 * squares the matrix, which is why it has not been done; the point of writing
 * the limit down is that the next person reading a green run knows what it
 * did not ask.
 */
const VALUE = {
  'inertia': '0.6',
  'transform-inertia': '0.9',
  'filter-inertia': '0.8',
  'inertia-ease': 'ease-out',
  'ease': 'ease-in-out',
  'pin': '40px',
  'perspective': '800px',
  'will-change': '',
  'transform-origin': 'top left',
  'when': '.on',
};

/** Everything the runtime writes to an element, as one comparable string. */
const written = (node) => [
  node.style.transform, node.style.filter, node.style.transition,
  node.style.position, node.style.top, node.style.perspective,
  node.style.willChange, node.style.transformOrigin,
].join(' | ');

/**
 * The settings this fixture cannot ask about, each with the reason and where it
 * *is* covered. Written down rather than omitted, because the completeness test
 * below reads both maps: a new setting has to land in one of them, which is the
 * check every hand-held list in this repository has eventually needed
 * (hand-held copies of live tables drift).
 */
const NOT_HERE = {
  'run-once': 'latches over time rather than showing in one frame — test/run-once-reparse.test.js',
  'stagger': 'belongs on the parent, not on the element under test — test/stagger-when.test.js',
  'path-selector': 'needs an SVG path in the fixture — test/path-diagnostics.test.js',
  'path-rotate': 'needs an SVG path in the fixture — test/path-diagnostics.test.js',
  'split': 'rewrites the element into pieces, so the subject stops existing — test/split-*.test.js',
  'frame-url': 'needs a canvas and @verajs/motion/sequence — test/sequence-*.test.js',
  'frame-count': 'needs a canvas and @verajs/motion/sequence — test/sequence-*.test.js',
  'frame-pad': 'needs a canvas and @verajs/motion/sequence — test/sequence-*.test.js',
  'frame-ext': 'needs a canvas and @verajs/motion/sequence — test/sequence-*.test.js',
  'frame-tween': 'needs a canvas and @verajs/motion/sequence — test/sequence-tween.test.js',
};

const attr = (name, value) => (value === '' ? `${P}-${name}` : `${P}-${name}="${value}"`);

describe('no setting is silently inert beside another', () => {
  /** What the runtime wrote for this set of settings, and what it refused. */
  const render = (names, scrollY) => {
    const { node, m } = build(names.map((n) => attr(n, VALUE[n])).join(' '), scrollY);
    const out = {
      style: written(node),
      reported: m.rejected.flatMap((entry) => entry.rejected ?? []).join(' '),
    };
    m.destroy();
    return out;
  };

  it('every pair either changes something or is reported', () => {
    const names = Object.keys(VALUE);
    const silent = [];

    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const pair = [names[i], names[j]];
        /** `when` holds it at the end, so the scrolled cases are read mid-timeline. */
        const scrollY = pair.includes('when') ? 0 : 1090;
        const both = render(pair, scrollY);

        for (const one of pair) {
          const without = render(pair.filter((n) => n !== one), scrollY);
          if (both.style !== without.style) continue;
          if (both.reported.includes(`-${one} `) || both.reported.includes(`-${one}=`)) continue;
          silent.push(`${pair[0]} + ${pair[1]}: \`${one}\` changed nothing, and nothing was said`);
        }
      }
    }

    expect(silent).toEqual([]);
  });

  /**
   * The control, and the reason the sweep above means anything: each setting
   * alone changes what the runtime writes. Without this a probe that compared
   * two identical renders would pass every pair.
   */
  it('and each one changes something on its own', () => {
    const inert = [];
    for (const name of Object.keys(VALUE)) {
      const scrollY = name === 'when' ? 0 : 1090;
      if (render([name], scrollY).style === render([], scrollY).style) inert.push(name);
    }
    expect(inert).toEqual([]);
  });
});

/**
 * And the map cannot quietly fall behind the registry. A setting added to
 * `schema.ts` or registered by a module has to be given an observable effect
 * here, or an explicit reason it cannot be — which is the same argument
 * `check:types` makes about the published declarations.
 */
describe('the matrix covers every setting there is', () => {
  it('each registered setting is either probed or excused', () => {
    const covered = new Set([...Object.keys(VALUE), ...Object.keys(NOT_HERE)]);
    const missing = registered()
      .map((setting) => setting.attribute)
      .filter((name) => !covered.has(name));

    expect(missing, 'add it to EFFECT, or to NOT_HERE with the reason').toEqual([]);
  });

  it('and nothing is excused that no longer exists', () => {
    const real = new Set(registered().map((setting) => setting.attribute));
    const stale = [...Object.keys(VALUE), ...Object.keys(NOT_HERE)].filter((name) => !real.has(name));

    expect(stale, 'a setting was removed and its entry outlived it').toEqual([]);
  });

  /**
   * And the pointers themselves. Each excuse names where the setting *is*
   * covered, and a name is only useful if it resolves: this map said
   * `test/sequence-tween.test.js`, which has never existed — the file is
   * `sequence-tween.test.js`. A dead pointer in the map written to stop things
   * going stale (hand-held copies of live tables drift) is the same failure one level up.
   */
  it('and every file an excuse points at is really there', () => {
    const present = readdirSync('test');
    const missing = [];
    for (const [name, reason] of Object.entries(NOT_HERE)) {
      for (const [, named] of reason.matchAll(/test\/([A-Za-z0-9*-]+\.test\.js)/g)) {
        const pattern = new RegExp(`^${named.replace(/[.]/g, '\\.').replace(/\*/g, '.*')}$`);
        if (!present.some((file) => pattern.test(file))) missing.push(`${name} -> test/${named}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
