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
    "{ keyframes: { opacity: '0% 0, 100% 1; [0-560]: 0% 0.5, 100% 1' } }",
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
