/**
 * The self-feeding render loop: detected, named once, and never stopped.
 *
 * `useEffect(() => { state.total = sum(state.rows) })` next to a template reading `state.total`
 * re-runs every frame for as long as the page is open. `useSyncEffect` can refuse that outright
 * because a *synchronous* self-feeding write is never deliberate; the coalesced path cannot, because
 * an animation is a self-feeding loop on purpose — Vera's default scheduler is already a frame, so
 * one store write per frame is the natural way to write one here.
 *
 * So the two claims that matter are opposites, and both are asserted below: the accidental loop is
 * **named**, and the frame-paced animation is **silent**. A guard that only does the first is worse
 * than no guard at all.
 */
import { load, isProduction } from './dist.mjs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<body></body>', { pretendToBeVisual: true });
for (const k of ['document', 'HTMLElement', 'Node', 'Element', 'customElements', 'Event',
                 'requestAnimationFrame', 'cancelAnimationFrame', 'DocumentFragment', 'Text',
                 'Comment', 'CSSStyleSheet'])
  globalThis[k] = dom.window[k];

const core = await load('core');
const { renderInto: renderer } = await load('renderer');
core.wire({ on: 'render', fn: renderer, priority: 50 });

const frame = () => new Promise((r) => dom.window.requestAnimationFrame(() => setTimeout(r, 0)));
const frames = async (n) => { for (let i = 0; i < n; i++) await frame(); };
const body = dom.window.document.body;

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => ok ? pass++ : (fail++, console.log('FAIL:', name, extra));

let seq = 0;
const define = (setup) => {
  const tag = `x-loop-${seq++}`;
  customElements.define(tag, class extends HTMLElement { connectedCallback() { setup(this); } });
  const element = dom.window.document.createElement(tag);
  body.appendChild(element);
  return element;
};

/** Collects `console.warn` for the duration of `work`, returning only the loop warnings. */
const listen = async (work) => {
  const said = [];
  const real = console.warn;
  console.warn = (...args) => said.push(args.join(' '));
  try { await work(); } finally { console.warn = real; }
  return said.filter((line) => line.includes('consecutive frames'));
};

/**
 * The threshold is 50, so 60 frames is comfortably past it while staying short enough that a
 * failure to *stop* the loop is what the count proves.
 */
const OVER = 60;

/* ── an accidental loop is named, once, and keeps running ───────────────────────────────────── */
{
  let ran = 0;
  let el;
  const warnings = await listen(async () => {
    el = define((element) => {
      core.init(element, { mode: 'open' });
      const state = core.createStore({ n: 0 });
      element._state = state;
      /** Reads `n` and writes it: the write feeds the pass that made it. */
      core.useEffect(() => { ran++; state.n = state.n + 1; });
      core.render(() => core.html`<p>${state.n}</p>`);
    });
    el._state.n = 1;
    await frames(OVER);
  });

  check('the loop actually ran', ran > OVER - 5, `${ran} runs in ${OVER} frames`);
  if (isProduction) {
    check('production says nothing', warnings.length === 0, warnings.join(' | '));
  } else {
    check('a self-feeding effect is named', warnings.length === 1, `${warnings.length}: ${warnings.join(' | ')}`);
    check('and named as useEffect', warnings[0]?.includes('useEffect'), warnings[0]);
    check('with the [vera] prefix', warnings[0]?.startsWith('[vera]'), warnings[0]);
    check('naming the animation case as legitimate', warnings[0]?.includes('allowRenderLoop'), warnings[0]);
  }

  /** The point of warning rather than throwing: the loop is still going. */
  const before = ran;
  await frames(10);
  check('the loop is not stopped', ran - before >= 8, `${ran - before} runs in 10 frames`);

  const after = await listen(async () => { await frames(OVER); });
  check('and it is not repeated every fiftieth frame', after.length === 0, after.join(' | '));
  el.remove();
}

/* ── the case that must stay silent: an animation driven by its own frame callback ───────────── */
{
  let ticks = 0;
  const warnings = await listen(async () => {
    const el = define((element) => {
      core.init(element, { mode: 'open' });
      const state = core.createStore({ t: 0 });
      element._state = state;
      /**
       * The write lands in a *later* frame, not inside the pass that scheduled it — which is the
       * whole discriminator. This is the shape an animation takes, and it must never warn.
       */
      core.useEffect(() => {
        void state.t;
        ticks++;
        dom.window.requestAnimationFrame(() => { state.t = state.t + 1; });
      });
      core.render(() => core.html`<p>${state.t}</p>`);
    });
    el._state.t = 1;
    await frames(OVER * 2);
    el.remove();
  });

  check('the animation ran for many frames', ticks > OVER, `${ticks} ticks`);
  check('a frame-paced animation never warns', warnings.length === 0, warnings.join(' | '));
}

/* ── a template that writes what it reads, which is the other half of the pass-87 table ──────── */
{
  let renders = 0;
  const warnings = await listen(async () => {
    const el = define((element) => {
      core.init(element, { mode: 'open' });
      const state = core.createStore({ n: 0, seen: 0 });
      element._state = state;
      core.render(() => {
        renders++;
        state.seen = state.n + renders;
        return core.html`<p>${state.seen}</p>`;
      });
    });
    el._state.n = 1;
    await frames(OVER);
    el.remove();
  });

  check('the template loop ran', renders > OVER - 5, `${renders} renders`);
  if (isProduction) check('production says nothing about a template loop', warnings.length === 0);
  else check('a self-feeding template is named', warnings.length === 1 && warnings[0].includes('a template'),
    `${warnings.length}: ${warnings.join(' | ')}`);
}

/* ── opting out, which is what the animation framework will do ──────────────────────────────── */
{
  let ran = 0;
  const warnings = await listen(async () => {
    const el = define((element) => {
      core.init(element, { mode: 'open' });
      const state = core.createStore({ t: 0 });
      element._state = state;
      core.allowRenderLoop(element);
      core.useEffect(() => { ran++; state.t = state.t + 1; });
      core.render(() => core.html`<p>${state.t}</p>`);
    });
    el._state.t = 1;
    await frames(OVER);
    el.remove();
  });

  check('the opted-out loop ran', ran > OVER - 5, `${ran} runs`);
  check('allowRenderLoop silences it', warnings.length === 0, warnings.join(' | '));
}

/* ── the false positive a global counter would produce ──────────────────────────────────────── */
{
  /**
   * Sixty unrelated components that each write once during a pass are not a loop. A single shared
   * counter would reach the threshold on the sixtieth and blame whichever one happened to be
   * running, so the streak is kept per element.
   */
  const warnings = await listen(async () => {
    const els = [];
    for (let i = 0; i < OVER; i++) {
      els.push(define((element) => {
        core.init(element, { mode: 'open' });
        const state = core.createStore({ n: 0, echo: 0 });
        element._state = state;
        core.useEffect(() => { state.echo = state.n; });
        core.render(() => core.html`<p>${state.echo}</p>`);
      }));
    }
    for (const el of els) { el._state.n = 1; await frame(); }
    await frames(5);
    for (const el of els) el.remove();
  });

  check('sixty components writing once each is not a loop', warnings.length === 0, warnings.join(' | '));
}

/* ── the false negative that keying on the *last* element would produce ─────────────────────── */
{
  /**
   * Two instances of one buggy component. Their passes alternate, so a counter keyed on "did the
   * same element feed twice in a row" never accumulates and both loops go unreported — which is why
   * the streak is a map rather than a last-seen check.
   */
  let ran = 0;
  const warnings = await listen(async () => {
    const make = () => define((element) => {
      core.init(element, { mode: 'open' });
      const state = core.createStore({ n: 0 });
      element._state = state;
      core.useEffect(() => { ran++; state.n = state.n + 1; });
      core.render(() => core.html`<p>${state.n}</p>`);
    });
    const a = make(), b = make();
    a._state.n = 1;
    b._state.n = 1;
    await frames(OVER);
    a.remove();
    b.remove();
  });

  check('both instances looped', ran > OVER, `${ran} runs`);
  if (isProduction) check('production says nothing about either', warnings.length === 0);
  else check('the same bug on two instances is reported twice, once each', warnings.length === 2,
    `${warnings.length}: ${warnings.join(' | ')}`);
}

/* ── the setter guard, which is the pass-79 rule applied to a new deferred API ───────────────── */
{
  const threw = (value) => {
    try { core.allowRenderLoop(value); return false; } catch { return true; }
  };
  if (isProduction) {
    check('production allowRenderLoop is a no-op', !threw(undefined) && !threw(null));
  } else {
    check('allowRenderLoop refuses undefined', threw(undefined));
    check('allowRenderLoop refuses a non-element', threw({}));
    check('allowRenderLoop accepts an element', !threw(dom.window.document.createElement('div')));
  }
}

/* ── the streak resets, so separate sub-limit bursts do not accumulate ───────────────────────── */

/**
 * **A converging loop is the shape the warning itself recommends.**
 *
 * "Guard the write (`if (next !== state.x) state.x = next`)" produces a loop that runs a few passes
 * and then stops — a list settling, a measurement converging. It is legitimate, and it is *not* the
 * animation case above, which is discriminated by its write landing in a later frame. This one writes
 * inside the pass, exactly as an accidental loop does, and differs only in stopping.
 *
 * So the guard has to count *consecutive* frames rather than total ones. Without the reset, an app
 * that converges forty passes twice an hour eventually warns about a loop that never existed — and a
 * warning the app trips on legitimately is one people learn to scroll past, which is the argument
 * `inserts.ts` already makes about its own replacement warning.
 *
 * The must-fire and must-not-fire cases above are both single episodes; this is the one that spans
 * two.
 */
{
  let passes = 0;
  const warnings = await listen(async () => {
    const el = define((element) => {
      core.init(element, { mode: 'open' });
      const state = core.createStore({ n: 0, target: 0 });
      element._state = state;
      core.useEffect(() => {
        passes++;
        if (state.n !== state.target) state.n = state.n + 1;
      });
      core.render(() => core.html`<p>${state.n}</p>`);
    });

    el._state.target = 40;
    await frames(OVER);
    /** Quiet frames in between: this is where the streak has to fall back to zero. */
    await frames(20);
    el._state.target = 80;
    await frames(OVER);
    el.remove();
  });

  /** Both bursts must have run, or "no warning" is just an idle component. */
  check('both bursts ran, past the limit in total', passes > 70, `${passes} passes`);
  check('two sub-limit bursts do not accumulate', warnings.length === 0, warnings.join(' | '));
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
