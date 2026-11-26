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
import { wireDirectives, motion, presets, paint, settled } from '../../packages/directives/dist/development/vera-directives.js';
import { ever, until } from './until.js';

wireDirectives([motion, presets, paint]);

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
 * perfectly animating page. The shared spec's contract is observable behavior, and computed style
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
   * assertion of "not 0.2" would have passed under both behaviors.
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

it('ease composes with play: mid-play sits on the CURVE, not the line', async () => {
  /**
   * The ratified lift's value half: `ease` shapes a play, never only its end. These two plays have one base and one
   * active value each and a single ease, so they compile to TRANSITION mode (motion's generator): the play is the
   * platform's transition on `filter` (it carries opacity()), and `ease` is that transition's timing function. (A
   * play with more keyframes runs on motion's rAF ramp instead, whose linear seek the keyframes' own timing reshapes.)
   * Under ease-in the value at half the play must sit WELL below the linear midpoint. The control is the same play
   * with no ease, read at the same instant — the comparison is what makes a slow machine unable to fake a pass in
   * either direction.
   */
  const host = page(`
    <div id="eased" data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' }, scroll: '50%', play: 0.6, ease: 'ease-in' }" style="height:50px">x</div>
    <div id="line" data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' }, scroll: '50%', play: 0.6 }" style="height:50px">x</div>`);
  const eased = host.querySelector('#eased');
  const line = host.querySelector('#line');
  await scrollTo(0);
  await settle();
  expect(opacityOf(eased), 'zero refusals, the authored start paints').to.equal(0);

  /**
   * **Read from the TRANSITIONS, paused at half their duration, not caught by polling frames** (2026-11-26). The play
   * is the platform's transition on `filter` (it carries opacity()); polled by frames, one long frame under a loaded
   * gate carried the control from below the mid-range to its end between two samples (WebKit, Windows), while the row
   * passed alone. Paused and seeked to the same fraction, both values are read at the same instant of their curves on
   * every engine and machine; an engine that snapped would make no transition, so the reading still fails it.
   */
  const running = () => {
    const curve = eased.getAnimations().find((a) => a.transitionProperty === 'filter');
    const control = line.getAnimations().find((a) => a.transitionProperty === 'filter');
    return curve && control ? { curve, control } : undefined;
  };
  /** A stall longer than the 0.6 s play can let it finish before it is found (a finished one leaves getAnimations()): up to three entries, each from rest. */
  let pair;
  for (let attempt = 0; attempt < 3 && pair === undefined; attempt++) {
    if (attempt > 0) {
      await scrollTo(0);
      await until(() => opacityOf(eased) === 0 && opacityOf(line) === 0, 'back at rest before the entry', 5000);
    }
    window.scrollTo(0, eased.offsetTop);
    await ever(() => (pair = running()) !== undefined, 2000);
  }
  expect(pair, 'both plays were caught running, in three tries').to.be.an('object');
  const { curve, control } = pair;
  curve.pause();
  control.pause();
  /** Half of the play AFTER its delay: transition mode emits a `transition-delay` for a staggered play (0 here). */
  const half = (transition) => transition.effect.getTiming().delay + transition.effect.getTiming().duration * 0.5;
  curve.currentTime = half(curve);
  control.currentTime = half(control);
  const linear = opacityOf(line);
  const bent = opacityOf(eased);
  curve.play();
  control.play();
  expect(linear, 'the CONTROL sits mid-range at half the play — the sample measured something').to.be.within(0.3, 0.8);
  expect(bent, 'ease-in lags the line — the curve is real during a play').to.be.below(linear - 0.05);

  await settle();
  await until(() => opacityOf(eased) === 1, 'the eased play landed on its end', 5000);
  expect(opacityOf(eased), 'and the play still lands on the authored end').to.equal(1);
});

it('paint blends natively (8c): red→blue reads MIXED mid-scroll, not stepped', async () => {
  const host = page(`<div id="pb" data-vd-motion="{ keyframes: { background: '0% rgb(255, 0, 0), 100% rgb(0, 0, 255)' }, inertia: 0 }" style="height:50px">x</div>`);
  const el = host.querySelector('#pb');
  await settle();
  /** Park mid-viewport, mid-timeline. The retired slot machinery would read pure red or pure
   *  blue anywhere; the native blend reads BOTH channels mid-range. Bounds, not exact numbers —
   *  engines blend in their own color space. */
  await scrollTo(el.offsetTop - window.innerHeight / 2);
  await settle();
  const rgb = (getComputedStyle(el).backgroundColor.match(/[\d.]+/g) ?? []).map(Number);
  expect(rgb[0], 'red is leaving').to.be.above(40).and.below(230);
  expect(rgb[2], 'blue is arriving').to.be.above(40).and.below(230);
});

it('transition-mode play: the compositor animates, reverses from current, and linear() overshoots', async function () {
  this.timeout(15000);
  const host = page(`
    <div id="t" data-vd-motion="{ keyframes: { opacity: '0% 0.1, 100% 0.9' }, scroll: '50%', play: 0.5 }" style="height:40px">x</div>
    <div id="o" data-vd-motion="{ keyframes: { translate-y: '0% 24px, 70% -12px, 100% 0px' }, scroll: '50%', play: 0.5 }" style="height:40px">x</div>`);
  const t = host.querySelector('#t');
  const o = host.querySelector('#o');
  await scrollTo(0);
  await settle();
  expect(t.hasAttribute('data-vm-on'), 'below the line: resting').to.equal(false);
  expect(opacityOf(t), 'base paints, no entry flash').to.be.closeTo(0.1, 0.02);

  /**
   * Cross the line: the marker flips and the platform's transition owns the next 500 ms. The mid-range and the dip are
   * read from the TRANSITION ITSELF, paused and seeked, not caught by polling frames: under a full WebKit suite the main
   * thread stalled through the whole 500 ms and the poll saw neither (measured on Windows, 2026-11-23, while the row
   * passed alone). An engine that snapped would make no transition, so the reading still fails it.
   */
  /** Both running transitions, `filter` on #t (it carries opacity()) and `transform` on #o, or undefined while either is missing. */
  const running = () => {
    const fade = t.getAnimations().find((a) => a.transitionProperty === 'filter');
    const dip = o.getAnimations().find((a) => a.transitionProperty === 'transform');
    return fade && dip ? { fade, dip } : undefined;
  };
  /**
   * A stall longer than the 500 ms can let a transition finish before it is found (a finished one leaves
   * getAnimations()), so up to three entries are tried, each from rest, as the reversal below does.
   */
  let pair;
  for (let attempt = 0; attempt < 3 && pair === undefined; attempt++) {
    if (attempt > 0) {
      await scrollTo(0);
      await until(() => !t.hasAttribute('data-vm-on') && Math.abs(opacityOf(t) - 0.1) < 0.02, 'back at rest before the entry', 5000);
    }
    window.scrollTo(0, t.offsetTop);
    await ever(() => (pair = running()) !== undefined, 2000);
  }
  expect(pair, 'both transitions were caught running, in three tries').to.be.an('object');
  const { fade, dip } = pair;
  /** The value `read` gives with the transition paused at `fraction` of its duration; then it runs on to its end. */
  const atFraction = (transition, fraction, read) => {
    transition.pause();
    transition.currentTime = transition.effect.getTiming().duration * fraction;
    const value = read();
    transition.play();
    return value;
  };
  expect(t.hasAttribute('data-vm-on'), 'entered: one attribute flip IS the driver').to.equal(true);
  const mid = atFraction(fade, 0.5, () => opacityOf(t));
  expect(mid > 0.25 && mid < 0.75, `the transition PASSES THROUGH the mid-range — animated, not snapped (${mid} at half)`).to.equal(true);
  const y = atFraction(dip, 0.7, () => new DOMMatrix(getComputedStyle(o).transform).m42);
  expect(y < -2, `the synthesized linear() carried the dip PAST the resting value (translateY ${y} at 70%)`).to.equal(true);
  await until(() => Math.abs(opacityOf(t) - 0.9) < 0.02, 'and landed on the authored end', 3000);

  /** Reverse mid-flight: back above the line partway through a fresh run — the platform
   *  reverses from the CURRENT value, retimed (the ratified semantics). */
  /**
   * Reversed from a value that IS mid-flight. The compositor runs the entry while the main thread may be stalled, so a
   * poll can miss the whole mid-range of one run (a loaded Firefox did, on Windows, 2026-11-21): up to three entries are
   * tried, each from rest. Back at rest first: two frames into the 500 ms reverse the element still read ~0.8, so an
   * entry started there never passed through the mid-range it is read in.
   */
  let midFlight;
  for (let attempt = 0; attempt < 3 && midFlight === undefined; attempt++) {
    await scrollTo(0);
    await until(() => !t.hasAttribute('data-vm-on') && Math.abs(opacityOf(t) - 0.1) < 0.02, 'back at rest before the entry', 5000);
    window.scrollTo(0, t.offsetTop);
    let seen;
    if (await ever(() => ((seen = opacityOf(t)) > 0.3 && seen < 0.7), 2000)) midFlight = seen;
  }
  expect(midFlight, 'an entry was caught mid-flight, in three tries').to.be.a('number');
  window.scrollTo(0, 0);
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));
  const justAfter = opacityOf(t);
  expect(Math.abs(justAfter - midFlight), 'reversal starts FROM the current value, never an endpoint')
    .to.be.below(0.2);
  const t1 = performance.now();
  let back = false;
  while (performance.now() - t1 < 2000) {
    await new Promise((r) => requestAnimationFrame(r));
    if (Math.abs(opacityOf(t) - 0.1) < 0.02) { back = true; break; }
  }
  expect(back, 'and settles back at the start').to.equal(true);
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

it('when+play delivers CLIENT-SIDE on a real sheet — the empty noJsRule never reaches insertRule', async () => {
  /** The matrix cell only a real engine can check: the when-fold's noJsRule is '' by design,
   *  and a real CSSOM throws SyntaxError on inserting '' where jsdom's fake sheet accepts it.
   *  Before the take-guard this quarantined the whole directive with a bare code-12 rejection
   *  — found by the play lab, reachable by this suite all along, written by nobody. */
  const el = document.createElement('div');
  el.setAttribute('data-vd-motion',
    "{ keyframes: { translate-y: '0% 0px, 100% 120px' }, when: '.on', play: 0.2 }");
  document.body.appendChild(el);
  await settled();
  /** The content-hash mark is set once delivery has finished, so it is the sentinel the survival read waits on. */
  await until(() => (el.getAttribute('data-vm-motion') ?? '').length > 0, 'delivery marked the element', 5000);
  expect(el.getAttribute('data-vd-motion'), 'the directive survived delivery').to.not.equal(null);
  expect((el.getAttribute('data-vm-motion') ?? '').length, 'marked with a content hash').to.be.greaterThan(0);
  el.remove();
  await settled();
});

it('a RAMP-KEPT play reverses on gate close — a reversed play, never a snap (the play lab\'s find)', async () => {
  const el = document.createElement('div');
  el.setAttribute('data-vd-motion',
    "{ keyframes: { opacity: '0% 0.2, 50% 1, 100% 0.8' }, when: '.go', play: 0.25, progress: '--q' }");
  document.body.appendChild(el);
  await settled();
  el.classList.add('go');
  const q = () => Number(el.style.getPropertyValue('--q'));
  await until(() => q() > 0.99, 'the play to reach its end', 3000);

  el.classList.remove('go');
  /** Read at every poll on the way back, not at a chosen instant: a sweep shows a value between the ends; a snap never. */
  expect(await ever(() => q() > 0.05 && q() < 0.95, 1500), 'mid-reverse the value is BETWEEN the ends — sweeping, not teleporting')
    .to.equal(true);
  await until(() => q() === 0, 'the reverse to arrive home', 3000);
  expect(q(), 'and it arrived home').to.equal(0);
  el.remove();
  await settled();
});
