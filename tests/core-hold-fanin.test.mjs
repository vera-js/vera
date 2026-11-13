/**
 * **A held pass asks for ONE frame, however many times it is re-queued in its flush** (D27, 2026-11-12). Past its
 * second run in a flush a pass is held for the element window's next frame (or a 100 ms timer). A self-feeding loop
 * reaches that once per flush; a FAN-IN reaches it once per writer: an automatic list's parent, re-queued by every
 * updated row when the list cannot commit its rows itself, asked for 98 frames and 98 timers on a 100-row update. Here
 * N effects each write what one effect reads, in one flush: the reader is re-queued past its second run N − 2 times.
 * (The fan-in is triggered AFTER mount: an effect's first run is inline at its creation, so the writers' setup writes
 * coalesce into one re-queue and never reach the hold.)
 * Exact counts: one frame and one timer for the whole fan-in; a self-feeding loop still runs exactly twice per frame;
 * and a later flush's hold asks again (2 frames over two flushes). And the PARENT's semantics are pinned: a held pass
 * written in an unrelated flush before its frame runs in that flush, and again at the frame (D27 must not hold writes).
 */
import { test, after } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<body></body>', { pretendToBeVisual: true });
for (const k of ['document', 'HTMLElement', 'Node', 'Element', 'customElements', 'Event', 'DocumentFragment', 'Text', 'Comment', 'CSSStyleSheet'])
  globalThis[k] = dom.window[k];

const core = await load('core');
const { renderInto } = await load('renderer');
core.wire({ on: 'render', fn: renderInto, priority: 50 });

/**
 * The hold path's two requests, counted where core makes them: the ELEMENT's window's frame, and a 100 ms timer. Frames
 * are driven BY HAND (`frame()` fires the callbacks asked so far), so "before its frame" is an order, not a race against
 * jsdom's 16 ms clock.
 */
const asked = { frames: 0, timers: 0 };
let pending = [];
dom.window.requestAnimationFrame = (fn) => { asked.frames++; pending.push(fn); return pending.length; };
dom.window.cancelAnimationFrame = (id) => { pending[id - 1] = null; };
const realTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...rest) => { if (ms === 100) asked.timers++; return realTimeout(fn, ms, ...rest); };
const reset = () => { asked.frames = 0; asked.timers = 0; };
const tick = () => new Promise((r) => realTimeout(r, 0));
const frame = async () => { const run = pending; pending = []; for (const fn of run) fn?.(performance.now()); await tick(); };

let seq = 0;
const mount = (setup) => {
  const tag = `x-fanin-${seq++}`;
  customElements.define(tag, class extends HTMLElement { connectedCallback() { core.init({ host: this, shadow: 'open' }, () => setup(this)); } });
  const element = dom.window.document.createElement(tag);
  dom.window.document.body.appendChild(element);
  return element;
};

const N = 10;
/** One reader of `v`, then N writers of it, all in one component: every writer's run re-queues the reader. */
const fanIn = () => {
  const out = { reads: 0, state: undefined };
  mount(() => {
    const state = core.createStore({ v: 0, go: 0 });
    out.state = state;
    core.effect(() => { void state.v; out.reads++; });
    /** Each writer re-runs when `go` changes, so a second fan-in is one write away. */
    for (let i = 1; i <= N; i++) core.effect(() => { state.v = state.go * 100 + i; });
    return () => core.html`<p></p>`;
  });
  return out;
};

test(`a fan-in of ${N} writers asks for exactly ONE frame and ONE timer`, async () => {
  const f = fanIn();
  await tick(); await frame(); await tick();
  reset();
  const before = f.reads;
  f.state.go = 1;
  await tick();
  assert.equal(f.reads - before, 2, 'the reader ran twice in the flush (its third run is held)');
  assert.equal(asked.frames, 1, `frames requested for ${N - 2} re-queues past the second run`);
  assert.equal(asked.timers, 1, 'timers requested');
  await frame(); await tick();
  assert.equal(f.reads - before, 3, 'the held pass ran once on its frame');
});

test('a later flush\'s fan-in asks for its own frame (2 over two flushes)', async () => {
  const f = fanIn();
  await tick(); await frame(); await tick();
  reset();
  f.state.go = 1;
  await tick(); await frame(); await tick();
  assert.equal(asked.frames, 1, 'the first fan-in asked once');
  const before = f.reads;
  f.state.go = 2;
  await tick();
  assert.equal(f.reads - before, 2, 'the second flush ran the reader twice and held it');
  assert.equal(asked.frames, 2, 'the second fan-in asked again: the flag did not stick');
  assert.equal(asked.timers, 2);
});

test('a held pass written in an UNRELATED flush before its frame runs there, and again at its frame', async () => {
  const f = fanIn();
  await tick(); await frame();
  reset();
  f.state.go = 1;
  await tick();
  const held = f.reads;
  /** Only that it WAS held: how many frames it asked is row 1's to pin, so this row reads the same on every variant that holds. */
  assert.ok(asked.frames > 0, 'the fan-in held the reader: a frame is pending');
  f.state.v = -1;
  await tick();
  assert.equal(f.reads - held, 1, 'it ran in the unrelated flush, before its frame');
  await frame();
  assert.equal(f.reads - held, 2, 'and again when its frame came');
});

test('CONTROL: a self-feeding loop still runs exactly twice per frame, with one frame asked per frame', async () => {
  let runs = 0;
  const element = mount(() => {
    const state = core.createStore({ n: 0 });
    core.effect(() => { runs++; state.n = state.n + 1; });
    return () => core.html`<p></p>`;
  });
  /** Its first run is inline at creation, so only the per-frame counts are exact: the loop settles into its frames. */
  await tick(); await frame(); await tick();
  for (let k = 1; k <= 5; k++) {
    reset();
    const before = runs;
    await frame(); await tick();
    assert.equal(runs - before, 2, `frame ${k}: two runs`);
    assert.equal(asked.frames, 1, `frame ${k}: one frame asked`);
  }
  /** Removed, the component's hooks retire and the loop ends, so the process can exit. */
  element.remove();
  await frame(); await frame();
  const after = runs;
  await frame(); await tick();
  assert.equal(runs, after, 'the loop stopped with its component');
});

/** The file must END on its own (a held pass's timer or frame chain left armed would keep it alive): a fresh process. */
test('the suite exits on its own', { skip: process.env.FANIN_CHILD === '1' }, () => {
  /** Only the resolution condition passes through (the runner's own flags would turn the child into a reporter); VERA_DIST rides in env. */
  const condition = process.execArgv.join(' ').match(/--conditions[= ](\S+)/);
  const r = spawnSync(process.execPath, [...(condition ? ['--conditions', condition[1]] : []), fileURLToPath(import.meta.url)], { env: { ...process.env, FANIN_CHILD: '1' }, timeout: 30000, killSignal: 'SIGKILL', encoding: 'utf8' });
  assert.equal(r.signal, null, 'it was killed at 30 s: something kept it alive');
  assert.equal(r.status, 0, r.stdout.slice(-2000));
});

after(() => {
  globalThis.setTimeout = realTimeout;
  dom.window.close();
});
