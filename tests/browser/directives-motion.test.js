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

/**
 * COMPUTED style, not inline — re-instrumented at the write-path flip. The old readings parsed
 * `el.style.filter`/`el.style.transform`, which was reading the MECHANISM: generated elements own
 * no inline values (CSS computes them from the variable), so those instruments read NaN off a
 * perfectly animating page. The shared spec's contract is observable behaviour, and computed style
 * is the one place both write paths — and any future one — must agree. Filter carries opacity(),
 * so computed `filter` still parses; transform computes to a matrix, so translateY is matrix `m42`.
 */
const opacityOf = (el) => {
  const match = /opacity\(([\d.]+)\)/.exec(getComputedStyle(el).filter);
  return match ? Number(match[1]) : NaN;
};
const translateOf = (el) => {
  const matrix = getComputedStyle(el).transform;
  const match = /matrix\(([^)]+)\)/.exec(matrix);
  return match ? Number(match[1].split(',')[5]) : NaN;
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

it('when GATES a scrub: closed it rests at the start, open it tracks scroll', async () => {
  const host = page(`<div id="w" data-vd-motion="{ keyframes: { opacity: '0% 0.2, 100% 0.8' }, when: '.go', inertia: 0 }" style="height:50px">x</div>`);
  const el = host.querySelector('#w');
  await settle();
  expect(opacityOf(el), 'unmatched: the authored start').to.equal(0.2);
  await scrollTo(el.offsetTop);
  expect(opacityOf(el), 'and still, wherever the page is scrolled').to.equal(0.2);

  el.classList.add('go');
  await settle();
  /**
   * **The whole change, and only a real browser can show it.** `when` used to REPLACE the scroll
   * driver, so a match jumped the element to its authored end (0.8). It gates now: a matching
   * element resumes the ordinary scrub, so at this scroll position it sits BETWEEN the ends. An
   * assertion of "not 0.2" would have passed under both behaviours.
   */
  const live = opacityOf(el);
  expect(live, 'matched: scrubbing with the page').to.be.greaterThan(0.2);
  expect(live, 'matched: and not jumped to the end').to.be.lessThan(0.8);

  el.classList.remove('go');
  await settle();
  expect(opacityOf(el), 'closed again: back to the start').to.equal(0.2);
});

it('play runs end-to-end at a threshold, and reverses coming back up past it', async () => {
  const host = page(`<div id="p" data-vd-motion="{ keyframes: { opacity: '0% 0.2, 100% 0.8' }, scroll: '50%', play: 0 }" style="height:50px">x</div>`);
  const el = host.querySelector('#p');
  await scrollTo(0);
  await settle();
  expect(opacityOf(el), 'below the line: the authored start').to.equal(0.2);

  /** Past the halfway line: the play has run, and a play is never mid-range. */
  await scrollTo(el.offsetTop);
  await settle();
  expect(opacityOf(el), 'past the threshold: the authored end, not a scroll position').to.equal(0.8);

  /** Back up above it: symmetric, which is what makes one threshold a reveal AND a hide. */
  await scrollTo(0);
  await settle();
  expect(opacityOf(el), 'back above the line: reversed').to.equal(0.2);
});

it('ease composes with play: the ramp sweeps, so mid-play sits on the CURVE, not the line', async () => {
  /**
   * The ratified lift's value half. The refusal this replaces guarded the old play — a transition
   * stepping end-to-end without visiting the keyframes — and the rAF ramp killed its premise: the
   * ramp writes the seek linearly over `play` seconds, and the CSS timing function reshapes each
   * segment as it is swept. Sampled mid-ramp: under ease-in the value must sit WELL below the
   * linear midpoint. The control is the same play with no ease, read at the same instant — the
   * comparison is what makes a slow machine unable to fake a pass in either direction.
   */
  const host = page(`
    <div id="eased" data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' }, scroll: '50%', play: 0.6, ease: 'ease-in' }" style="height:50px">x</div>
    <div id="line" data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' }, scroll: '50%', play: 0.6 }" style="height:50px">x</div>`);
  const eased = host.querySelector('#eased');
  const line = host.querySelector('#line');
  await scrollTo(0);
  await settle();
  expect(opacityOf(eased), 'zero refusals, the authored start paints').to.equal(0);

  await scrollTo(eased.offsetTop);
  /** Sample while BOTH ramps run, no chosen instant: wait until the control is mid-flight. */
  let guard = 200;
  while (guard-- > 0) {
    await new Promise((r) => requestAnimationFrame(r));
    const at = opacityOf(line);
    if (at > 0.35 && at < 0.75) break;
  }
  const linear = opacityOf(line);
  expect(linear, 'the CONTROL entered the mid-range — the sample measured something')
    .to.be.within(0.3, 0.8);
  expect(opacityOf(eased), 'ease-in lags the line — the curve is real during a play')
    .to.be.below(linear - 0.05);

  await settle();
  await new Promise((r) => setTimeout(r, 700));
  expect(opacityOf(eased), 'and the ramp still lands on the authored end').to.equal(1);
});

it('teardown returns the element to its natural state with the page scrolled anywhere', async () => {
  const host = page(`<div id="d" data-vd-motion="fade-up" style="height:100px">x</div>`);
  const el = host.querySelector('#d');
  await settle();
  await scrollTo(el.offsetTop - window.innerHeight / 2);
  expect(translateOf(el), 'animating mid-page').to.be.greaterThan(0);
  el.removeAttribute('data-vd-motion');
  await settle();
  expect(el.style.transform, 'nothing of the pack left behind').to.equal('');
  expect(el.style.filter).to.equal('');
});
