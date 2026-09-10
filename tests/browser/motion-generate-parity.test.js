/**
 * PARITY: the generated CSS paints what the runtime paints — same attribute, same progress, twin
 * elements, computed styles compared at real scroll positions on real engines.
 *
 * This is the stage-3 gate from the write-path spec. Twin A is the OLD path: a live `data-vd-motion`
 * element, `inertia: 0` so values track scroll exactly. Twin B is the NEW path: the same attribute
 * string through the real parser and `generateSimple`, its rule acquired, its animation seeked by
 * the progress property — with B's number mirrored from A's `onProgress`, so the DRIVER is identical
 * by construction and any disagreement is the value math. That is the exact seam stage 4 swaps.
 *
 * Two bundles on purpose, and it is sound here: the runtime half (wire, motion) comes from the root
 * bundle, generation from the motion bundle. They share no state — the registry serves only twin B,
 * and A/B meet through computed styles, not through modules.
 */
import { expect } from '@esm-bundle/chai';
import { wireDirectives, motion, presets, settled } from '../../packages/directives/dist/development/vera-directives.js';
import { keyframeRegistry, writePath } from '../../packages/directives/dist/development/vera-directives-motion.js';

/** Three properties across both categories, misaligned stops, linear — the union-resampling case. */
const VALUE =
  "{ keyframes: { opacity: '0% 0.2, 100% 0.9', translate-y: '0% 80px, 50% 10px, 100% 0px', " +
  "rotate: '0% 0deg, 100% 90deg' } }";

let progress = 0;
wireDirectives([motion({ inertia: 0, onProgress: (node, value) => { progress = value; } }), presets]);

const frame = () => new Promise((r) => requestAnimationFrame(r));
const settle = async () => { await settled(); await frame(); await frame(); };
const scrollTo = async (y) => { window.scrollTo(0, y); await frame(); await settle(); };

const matrixOf = (el) => getComputedStyle(el).transform;
const numbers = (matrix) => (matrix.match(/-?[\d.]+/g) ?? []).map(Number);

it('twin computed styles agree across scroll positions, on every engine', async () => {
  document.body.style.margin = '0';
  const spacer = document.createElement('div');
  spacer.style.height = '300vh';
  const a = document.createElement('div');
  a.setAttribute('data-vd-motion', VALUE);
  a.style.cssText = 'height:50px';
  const b = document.createElement('div');
  b.style.cssText = 'height:50px';
  spacer.appendChild(a);
  document.body.append(spacer, b);

  /** The whole new path, through the real parser: generate → acquire → THEN mark. */
  const generated = writePath.fromAttribute(b, VALUE);
  expect(generated, 'the fixture is inside generateSimple’s scope').to.not.equal(null);
  keyframeRegistry.ensureProperty('--vd-p', document.documentElement);
  for (const g of generated.groups) keyframeRegistry.acquire(document, g.hash, g.rule);
  b.style.cssText = `height:50px; ${generated.elementStyle}`;

  await settle();

  /**
   * Mid-range positions only, ON PURPOSE. At the clamped ends both paths sit on authored values
   * and agree trivially; mid-range is where interpolation, composition order and the seek must all
   * agree at once. The control asserts the range was really entered — a parity suite whose twins
   * both sat at an end would pass while measuring nothing.
   */
  const compared = [];
  for (const y of [0, 120, 260, 420, 600]) {
    await scrollTo(a.offsetTop - window.innerHeight + y);
    b.style.setProperty('--vd-p', String(progress));
    await frame();

    const opacityA = Number(getComputedStyle(a).opacity);
    const opacityB = Number(getComputedStyle(b).opacity);
    expect(Math.abs(opacityA - opacityB), `opacity at progress ${progress}`).to.be.below(0.02);

    const matrixA = numbers(matrixOf(a));
    const matrixB = numbers(matrixOf(b));
    expect(matrixB.length, 'both twins carry a transform').to.equal(matrixA.length);
    for (let i = 0; i < matrixA.length; i++) {
      expect(Math.abs(matrixA[i] - matrixB[i]), `matrix[${i}] at progress ${progress}`).to.be.below(0.5);
    }
    if (progress > 0.05 && progress < 0.95) compared.push(progress);
  }
  expect(compared.length, 'the CONTROL: real mid-range positions were compared').to.be.above(1);

  for (const g of generated.groups) keyframeRegistry.release(g.hash);
  spacer.remove();
  b.remove();
});

it('identical attributes on different elements share one rule; a tuned twin does not', () => {
  const x = document.createElement('div');
  const y = document.createElement('div');
  const first = writePath.fromAttribute(x, VALUE);
  const second = writePath.fromAttribute(y, VALUE);
  expect(second.hash, 'two hundred fade-ups, one rule').to.equal(first.hash);
  expect(second.groups[0].rule).to.equal(first.groups[0].rule);

  const tuned = writePath.fromAttribute(y, VALUE.replace('80px', '81px'));
  expect(tuned.hash, 'one byte of tuning is a different animation').to.not.equal(first.hash);
});

it('out-of-scope values answer null and name the old path, not a throw', () => {
  const el = document.createElement('div');
  /** What remains out of scope after easing groups: a split CSS itself cannot express, geometry
   *  units, stagger. The one-property collision rule is the boundary — two eases inside `filter`
   *  would be two list entries writing one property, where the later wins and nothing composes. */
  for (const raw of [
    "{ keyframes: { opacity: { frames: '0% 0, 100% 1', ease: 'ease-in' }, blur: '0% 8px, 100% 0px' } }",
    /** skew has no independent property, so a transform split cannot flip — old path. */
    "{ keyframes: { skew-x: '0% 20deg, 100% 0deg', rotate: { frames: '0% 0deg, 100% 90deg', ease: 'ease-in' } } }",
    "{ keyframes: { translate-y: '0px 10px, 100px 0px' } }",
    "{ stagger: '10%' }",
  ]) {
    expect(writePath.fromAttribute(el, raw), raw).to.equal(null);
  }
  /** And the graduates: a band under a non-linear ease (aligned per segment), and a per-property
   *  ease — both null before easing groups, both in scope now. */
  for (const raw of [
    "{ keyframes: { opacity: '0% 0, 100% 1; [0-560]: 0% 0.5, 100% 1' }, ease: 'ease-in' }",
    "{ keyframes: { opacity: { frames: '0% 0, 100% 1', ease: 'ease-in' } } }",
  ]) {
    expect(writePath.fromAttribute(el, raw), raw).to.not.equal(null);
  }
});

it('the ease string is emitted verbatim — the browser is the solver now', () => {
  const el = document.createElement('div');
  const generated = writePath.fromAttribute(
    el, "{ keyframes: { opacity: '0% 0, 100% 1' }, ease: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }");
  expect(generated.elementStyle).to.include('cubic-bezier(0.34, 1.56, 0.64, 1)');
  /** And a non-linear ease with MISALIGNED stops stays on the old path — splitting a segment
   *  would reshape what the author wrote, since ease applies per segment on both sides. */
  const misaligned = writePath.fromAttribute(
    el,
    "{ keyframes: { opacity: '0% 0, 100% 1', translate-y: '0% 10px, 50% 5px, 100% 0px' }, ease: 'ease-in' }");
  expect(misaligned).to.equal(null);
});

/* ── stage 5b: width bands as @media segments ────────────────────────────────────────────────── */

it('a band composes its own segment, switched by @media — and agrees with the old path’s merge', async () => {
  /**
   * The band edge is placed around the RUNNER'S OWN viewport width, so both branches are exercised
   * deterministically on whatever machine runs this: `applies` covers the current width, `misses`
   * starts one pixel above it. The expected values come from the same merge the resize path runs.
   */
  const w = window.innerWidth;
  const build = (edge) =>
    writePath.fromAttribute(document.createElement('div'),
      `{ keyframes: { opacity: '0% 0.6, 100% 0.6; [0-${edge}]: 0% 0.1, 100% 0.1' } }`);

  const applies = build(w + 50);
  const misses = build(w - 1 > 0 ? w - 1 : 1) && writePath.fromAttribute(document.createElement('div'),
      `{ keyframes: { opacity: '0% 0.6, 100% 0.6; [${w + 1}-${w + 999}]: 0% 0.1, 100% 0.1' } }`);

  for (const [generated, expected, label] of [[applies, 0.1, 'band covers viewport'], [misses, 0.6, 'band misses viewport']]) {
    expect(generated.segments.length, `${label}: one segment generated`).to.be.above(0);
    keyframeRegistry.ensureProperty('--vd-p', document.documentElement);
    for (const g of generated.groups) keyframeRegistry.acquire(document, g.hash, g.rule);
    for (const s of generated.segments) for (const r of s.rules) keyframeRegistry.acquire(document, r.hash, r.rule);
    keyframeRegistry.acquire(document, `${generated.hash}#el`, generated.elementRule);
    /** Switches AFTER the element rule — they tie on specificity, so sheet order decides. */
    generated.segments.forEach((s, i) => keyframeRegistry.acquire(document, `${generated.hash}#m${i}`, s.media));

    const el = document.createElement('div');
    document.body.appendChild(el);
    el.setAttribute('data-vd-a', generated.hash);
    el.style.setProperty('--vd-p', '0.5');
    await frame();
    expect(Number(getComputedStyle(el).filter.match(/opacity\(([\d.]+)\)/)?.[1] ?? NaN), label)
      .to.be.closeTo(expected, 0.01);

    for (const g of generated.groups) keyframeRegistry.release(g.hash);
    for (const s of generated.segments) for (const r of s.rules) keyframeRegistry.release(r.hash);
    generated.segments.forEach((s, i) => keyframeRegistry.release(`${generated.hash}#m${i}`));
    keyframeRegistry.release(`${generated.hash}#el`);
    el.remove();
  }
});

it('identical band content dedupes to one segment hash; the MARKER hash still differs from bandless', () => {
  const el = document.createElement('div');
  const banded = writePath.fromAttribute(el, "{ keyframes: { opacity: '0% 0.6, 100% 0.6; [0-560]: 0% 0.1, 100% 0.1' } }");
  const bandless = writePath.fromAttribute(el, "{ keyframes: { opacity: '0% 0.6, 100% 0.6' } }");
  expect(banded.groups[0].name, 'the BASE composition is byte-identical, so the base rule is shared')
    .to.equal(bandless.groups[0].name);
  expect(banded.hash, 'but the marker identity differs — a band is part of who the element is')
    .to.not.equal(bandless.hash);
});

/* ── stage 5b remainder: easing groups, the transform flip, per-category variables ───────────── */

/** Acquire everything a Generated needs, mark, and hand back a teardown. */
const mountGenerated = (generated) => {
  for (const name of generated.vars.map((v) => v.name)) {
    keyframeRegistry.ensureProperty(name, document.documentElement);
  }
  for (const g of generated.groups) keyframeRegistry.acquire(document, g.hash, g.rule);
  for (const s of generated.segments) for (const r of s.rules) keyframeRegistry.acquire(document, r.hash, r.rule);
  keyframeRegistry.acquire(document, `${generated.hash}#el`, generated.elementRule);
  generated.segments.forEach((s, i) => keyframeRegistry.acquire(document, `${generated.hash}#m${i}`, s.media));
  const el = document.createElement('div');
  document.body.appendChild(el);
  el.setAttribute('data-vd-a', generated.hash);
  return {
    el,
    done: () => {
      for (const g of generated.groups) keyframeRegistry.release(g.hash);
      for (const s of generated.segments) for (const r of s.rules) keyframeRegistry.release(r.hash);
      generated.segments.forEach((s, i) => keyframeRegistry.release(`${generated.hash}#m${i}`));
      keyframeRegistry.release(`${generated.hash}#el`);
      el.remove();
    },
  };
};

const filterOpacity = (el) =>
  Number(getComputedStyle(el).filter.match(/opacity\(([\d.]+)\)/)?.[1] ?? NaN);

it('a per-property ease is its own animation — two entries, one variable, different curves', async () => {
  const generated = writePath.fromAttribute(document.createElement('div'),
    "{ keyframes: { opacity: { frames: '0% 0, 100% 1', ease: 'ease-in' }, translate-y: '0% 80px, 100% 0px' } }");
  expect(generated.groups.length, 'two timing functions, two list entries').to.equal(2);

  const { el, done } = mountGenerated(generated);
  el.style.setProperty('--vd-p', '0.5');
  await frame();
  /** ease-in at 0.5 sits well below linear; the linear translate sits exactly at its midpoint. */
  expect(filterOpacity(el), 'the eased entry follows ITS curve').to.be.below(0.4);
  expect(filterOpacity(el)).to.be.above(0.2);
  const m42 = numbers(getComputedStyle(el).transform)[5];
  expect(m42, 'the linear entry is untouched by its neighbour’s ease').to.be.closeTo(40, 0.5);
  done();
});

it('a transform split flips to independent properties — translate and rotate, each on its own curve', async () => {
  const generated = writePath.fromAttribute(document.createElement('div'),
    "{ keyframes: { translate-y: '0% 80px, 100% 0px', rotate: { frames: '0% 0deg, 100% 90deg', ease: 'ease-in' } } }");
  expect(generated.groups.length, 'the split that forces the flip').to.equal(2);

  const { el, done } = mountGenerated(generated);
  el.style.setProperty('--vd-p', '0.5');
  await frame();
  const style = getComputedStyle(el);
  expect(style.translate, 'translate is its own property now').to.equal('0px 40px');
  const angle = Number(style.rotate.match(/([\d.]+)deg/)?.[1] ?? NaN);
  expect(angle, 'rotate rides ease-in — below the linear 45').to.be.below(40);
  expect(angle).to.be.above(20);
  done();
});

it('a category inertia override seeks by its own variable, and only then', async () => {
  const generated = writePath.fromAttribute(document.createElement('div'),
    "{ keyframes: { opacity: '0% 0, 100% 1', translate-y: '0% 80px, 100% 0px' }, transform-inertia: 0.5 }");
  expect(generated.vars.map((v) => v.name).sort(), 'base plus the transform override')
    .to.deep.equal(['--vd-p', '--vd-p-transform']);
  expect(generated.vars.find((v) => v.name === '--vd-p-transform').inertiaKey)
    .to.equal('transform-inertia');

  const { el, done } = mountGenerated(generated);
  /** Two variables, two numbers — the transform lags at 0.25 while opacity has arrived at 1. */
  el.style.setProperty('--vd-p', '1');
  el.style.setProperty('--vd-p-transform', '0.25');
  await frame();
  expect(filterOpacity(el), 'the base variable drives filter').to.be.closeTo(1, 0.01);
  expect(numbers(getComputedStyle(el).transform)[5], 'its own variable drives transform')
    .to.be.closeTo(60, 0.5);
  done();

  const bare = writePath.fromAttribute(document.createElement('div'),
    "{ keyframes: { opacity: '0% 0, 100% 1', translate-y: '0% 80px, 100% 0px' } }");
  expect(bare.vars.length, 'no override, no second variable — the common case stays one').to.equal(1);
  expect(bare.groups.length, 'and one list entry').to.equal(1);
});
