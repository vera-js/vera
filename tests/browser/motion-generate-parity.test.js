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
  keyframeRegistry.acquire(document, generated.hash, generated.keyframesRule);
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

  keyframeRegistry.release(generated.hash);
  spacer.remove();
  b.remove();
});

it('identical attributes on different elements share one rule; a tuned twin does not', () => {
  const x = document.createElement('div');
  const y = document.createElement('div');
  const first = writePath.fromAttribute(x, VALUE);
  const second = writePath.fromAttribute(y, VALUE);
  expect(second.hash, 'two hundred fade-ups, one rule').to.equal(first.hash);
  expect(second.keyframesRule).to.equal(first.keyframesRule);

  const tuned = writePath.fromAttribute(y, VALUE.replace('80px', '81px'));
  expect(tuned.hash, 'one byte of tuning is a different animation').to.not.equal(first.hash);
});

it('out-of-scope values answer null and name the old path, not a throw', () => {
  const el = document.createElement('div');
  /** Bands, per-property ease, discrete packs, geometry units — each routes to the old path. */
  for (const raw of [
    /** Bands are IN scope since 5b — what stays out is a band under a non-linear element ease,
     *  where the per-segment aligned-stops rule is deferred with easing groups. */
    "{ keyframes: { opacity: '0% 0, 100% 1; [0-560]: 0% 0.5, 100% 1' }, ease: 'ease-in' }",
    "{ keyframes: { opacity: { frames: '0% 0, 100% 1', ease: 'ease-in' } } }",
    "{ keyframes: { translate-y: '0px 10px, 100px 0px' } }",
    "{ stagger: '10%' }",
  ]) {
    expect(writePath.fromAttribute(el, raw), raw).to.equal(null);
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
    keyframeRegistry.acquire(document, generated.hash, generated.keyframesRule);
    for (const s of generated.segments) keyframeRegistry.acquire(document, s.hash, s.rule);
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

    keyframeRegistry.release(generated.hash);
    for (const s of generated.segments) keyframeRegistry.release(s.hash);
    generated.segments.forEach((s, i) => keyframeRegistry.release(`${generated.hash}#m${i}`));
    keyframeRegistry.release(`${generated.hash}#el`);
    el.remove();
  }
});

it('identical band content dedupes to one segment hash; the MARKER hash still differs from bandless', () => {
  const el = document.createElement('div');
  const banded = writePath.fromAttribute(el, "{ keyframes: { opacity: '0% 0.6, 100% 0.6; [0-560]: 0% 0.1, 100% 0.1' } }");
  const bandless = writePath.fromAttribute(el, "{ keyframes: { opacity: '0% 0.6, 100% 0.6' } }");
  expect(banded.name, 'the BASE composition is byte-identical, so the base rule is shared')
    .to.equal(bandless.name);
  expect(banded.hash, 'but the marker identity differs — a band is part of who the element is')
    .to.not.equal(bandless.hash);
});
