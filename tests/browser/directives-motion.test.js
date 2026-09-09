/**
 * The motion pack under REAL geometry — the half jsdom cannot answer: scroll
 * positions driving the timeline, clamping at both ends, mid-flight
 * interpolation, and the stagger cascade with true offsets. Values are
 * asserted as ORDER and BOUNDS, never as exact numbers: viewport size
 * differs per engine and per runner config, and a recording is only as
 * portable as the machine it was taken on.
 *
 * `inertia: 0` throughout, so values track scroll exactly and no assertion
 * waits on a transition it cannot see finish deterministically.
 */
import { expect } from '@esm-bundle/chai';
import { wireDirectives, motion, presets, settled } from '../../packages/directives/dist/development/vera-directives.js';

wireDirectives([motion, presets]);

const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
const settle = async () => {
  await settled();
  await frame();
  await frame();
};

/** Scroll, then let the rAF-aligned listener run its pass. */
const scrollTo = async (y) => {
  window.scrollTo(0, y);
  await frame();
  await frame();
};

const opacityOf = (el) => {
  const match = /opacity\(([\d.]+)\)/.exec(el.style.filter);
  return match ? Number(match[1]) : NaN;
};
const translateOf = (el) => {
  const match = /translateY\(([\d.-]+)px\)/.exec(el.style.transform);
  return match ? Number(match[1]) : NaN;
};

const page = (inner) => {
  const host = document.createElement('div');
  host.innerHTML = `<div style="height:${window.innerHeight * 3}px"></div>${inner}<div style="height:${window.innerHeight * 3}px"></div>`;
  document.body.appendChild(host);
  return host;
};

afterEach(async () => {
  window.scrollTo(0, 0);
  document.querySelectorAll('body > div').forEach((n) => n.remove());
  await settle();
});

it('the timeline follows scroll: clamped start below the fold, mid-flight between, clamped end above', async () => {
  const host = page(`<div id="t" data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1', translate-y: '0% 40px, 100% 0px' }, inertia: 0 }" style="height:100px">x</div>`);
  const el = host.querySelector('#t');
  await settle();

  /** Three viewports below the fold: entering has not begun. */
  expect(opacityOf(el), 'start: opacity clamps to the first keyframe').to.equal(0);
  expect(translateOf(el), 'start: translate clamps too').to.equal(40);

  /** Element roughly centered in the viewport: strictly mid-flight. */
  const mid = el.offsetTop - window.innerHeight / 2;
  await scrollTo(mid);
  const opacity = opacityOf(el);
  const translate = translateOf(el);
  expect(opacity, 'mid: strictly between the keyframes').to.be.greaterThan(0).and.lessThan(1);
  expect(translate, 'mid: moving toward rest').to.be.greaterThan(0).and.lessThan(40);

  /** Further scroll moves it further — monotonic with scroll, the core claim. */
  await scrollTo(mid + window.innerHeight / 2);
  expect(opacityOf(el), 'more scroll, more progress').to.be.greaterThan(opacity);
  expect(translateOf(el), 'and less remaining travel').to.be.lessThan(translate);

  /** Far past: clamped on the last keyframe. */
  await scrollTo(el.offsetTop + window.innerHeight * 2.5);
  expect(opacityOf(el), 'end: opacity clamps to the last keyframe').to.equal(1);
  expect(translateOf(el), 'end: translate rests').to.equal(0);
});

it('the stagger cascade is real offsets: siblings at one scroll position sit at descending progress', async () => {
  const host = page(`
    <div data-vd-motion="{ stagger: '15%' }">
      <div class="s" data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' }, inertia: 0 }" style="height:40px">a</div>
      <div class="s" data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' }, inertia: 0 }" style="height:40px">b</div>
      <div class="s" data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' }, inertia: 0 }" style="height:40px">c</div>
    </div>`);
  await settle();
  const items = [...host.querySelectorAll('.s')];
  /** Park the row mid-viewport, where every member is mid-flight. */
  await scrollTo(items[0].offsetTop - window.innerHeight / 2);
  const values = items.map(opacityOf);
  for (const v of values) expect(v, 'every member is animating').to.be.greaterThan(0).and.lessThan(1);
  /**
   * The cascade: each later sibling's keyframes are shifted later, so at one
   * instant its progress is STRICTLY lower. (Siblings this close share a
   * scroll window, so without the stagger the three would be equal — which
   * is exactly what the parent's stagger exists to prevent.)
   */
  expect(values[0], 'first leads second').to.be.greaterThan(values[1]);
  expect(values[1], 'second leads third').to.be.greaterThan(values[2]);
});

it('a when element ignores scroll and walks between its authored ends on the selector', async () => {
  const host = page(`<div id="w" data-vd-motion="{ keyframes: { opacity: '0% 0.2, 100% 0.8' }, when: '.go', inertia: 0 }" style="height:50px">x</div>`);
  const el = host.querySelector('#w');
  await settle();
  expect(opacityOf(el), 'unmatched: the authored start, wherever the page is scrolled').to.equal(0.2);
  await scrollTo(el.offsetTop);
  expect(opacityOf(el), 'scroll does not drive it').to.equal(0.2);
  el.classList.add('go');
  await settle();
  expect(opacityOf(el), 'matched: the authored end').to.equal(0.8);
  el.classList.remove('go');
  await settle();
  expect(opacityOf(el), 'and back').to.equal(0.2);
});

it('teardown returns the element to its natural state with the page scrolled anywhere', async () => {
  const host = page(`<div id="d" data-vd-motion="fade-up" style="height:100px">x</div>`);
  const el = host.querySelector('#d');
  await settle();
  await scrollTo(el.offsetTop - window.innerHeight / 2);
  expect(el.style.transform, 'animating mid-page').to.contain('translateY');
  el.removeAttribute('data-vd-motion');
  await settle();
  expect(el.style.transform, 'nothing of the pack left behind').to.equal('');
  expect(el.style.filter).to.equal('');
});
