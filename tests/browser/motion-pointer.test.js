/**
 * Pointer as a timeline source — the SPEC's live fixtures, which need a real engine: the
 * capability query matches, real pointer events drive the variable, and the composed-play
 * jitter pin. String/number assertions only (the motion-verify scar).
 *
 * Headless engines answer `(hover: hover) and (pointer: fine)` differently per platform, so
 * every fixture first asks — an engine reporting coarse SKIPS the live half (the node suite
 * already proves the rest pose for exactly that environment).
 */
import { expect } from '@esm-bundle/chai';
import { wireDirectives, motion, settled } from '../../packages/directives/dist/development/vera-directives.js';

wireDirectives([motion({ inertia: 0 })]);

const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
const frame = () => new Promise((r) => requestAnimationFrame(r));
const progressOf = (el) => Number(el.style.getPropertyValue('--vm-p'));
const move = async (x, y) => {
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y }));
  await frame();
  await frame();
};

const mount = async (attr) => {
  const el = document.createElement('div');
  el.setAttribute('data-vd-motion', attr);
  document.body.appendChild(el);
  await settled();
  await frame();
  await frame();
  return el;
};

it('FIXTURES 1+2 — x tracks the viewport, distance is euclidean and clamps to 1 outside', async function () {
  if (!fine) this.skip();
  const x = await mount("{ keyframes: { opacity: '0% 0.2, 100% 1' }, pointer: 'x' }");
  await move(0, 100);
  expect(progressOf(x), 'left edge').to.equal(0);
  await move(window.innerWidth, 100);
  expect(progressOf(x), 'right edge').to.equal(1);
  await move(window.innerWidth / 2, 100);
  expect(progressOf(x), 'center').to.be.closeTo(0.5, 0.01);

  const d = await mount("{ keyframes: { opacity: '0% 1, 100% 0.2' }, pointer: 'distance' }");
  await move(window.innerWidth / 2, window.innerHeight / 2);
  expect(progressOf(d), 'viewport center').to.be.closeTo(0, 0.01);
  await move(0, 0);
  expect(progressOf(d), 'the corner is exactly the half-diagonal').to.be.closeTo(1, 0.01);
  x.remove(); d.remove();
  await settled();
});

it('FIXTURE 4 (live half) — on a fine pointer, x drives and the scroll fallback stays quiet', async function () {
  if (!fine) this.skip();
  const el = await mount("{ keyframes: { opacity: '0% 0.2, 100% 1' }, pointer: 'x, scroll' }");
  await move(window.innerWidth, 50);
  expect(progressOf(el), 'the first available source won').to.equal(1);
  await move(0, 50);
  expect(progressOf(el)).to.equal(0);
  el.remove();
  await settled();
});

it('THE SMOOTHNESS PIN — under inertia, the chase travels monotonically to each new target', async function () {
  if (!fine) this.skip();
  /** inertia composes: the pointer moves the TARGET, the chase takes the time — the
   *  mouse-follow feel. The pin (the record's jitter requirement, retargeted with the play
   *  deferral): sampling during the chase never sees a backward step, and it arrives. */
  const el = await mount("{ keyframes: { opacity: '0% 0.2, 100% 1' }, pointer: 'x', inertia: 0.3 }");
  await move(0, 50);
  await new Promise((r) => setTimeout(r, 500));
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: window.innerWidth, clientY: 50 }));
  const samples = [];
  for (let i = 0; i < 30; i++) {
    await frame();
    samples.push(progressOf(el));
  }
  const backsteps = samples.filter((v, i) => i > 0 && v < samples[i - 1] - 1e-6).length;
  expect(backsteps, `no backward step across the chase (${samples.map((s) => s.toFixed(2)).join(',')})`).to.equal(0);
  expect(samples[samples.length - 1], 'and it arrived').to.be.closeTo(1, 0.05);
  el.remove();
  await settled();
});

it('THE SWEEP PIN — under play, the ramp travels monotonically to the pointer and arrives', async function () {
  if (!fine) this.skip();
  /** play composes via the gauntlet's pointer row: seek emission, the proportional ramp
   *  sweeping to each new pointer target at `play`-per-full-span speed. The original jitter
   *  requirement, restored with the composition. */
  const el = await mount("{ keyframes: { opacity: '0% 0.2, 100% 1' }, pointer: 'x', play: 0.25 }");
  await move(0, 50);
  await new Promise((r) => setTimeout(r, 400));
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: window.innerWidth, clientY: 50 }));
  const samples = [];
  for (let i = 0; i < 25; i++) {
    await frame();
    samples.push(progressOf(el));
  }
  const backsteps = samples.filter((v, i) => i > 0 && v < samples[i - 1] - 1e-6).length;
  expect(backsteps, `no backward step across the sweep (${samples.map((s) => s.toFixed(2)).join(',')})`).to.equal(0);
  expect(samples[samples.length - 1], 'and it arrived').to.be.closeTo(1, 0.05);
  el.remove();
  await settled();
});
