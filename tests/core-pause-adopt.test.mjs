/**
 * **A paused component taken into another window stays alive there** (2026-11-23). `B.adoptNode(el)` and then an
 * append in B moves a component between windows; the platform runs its `disconnectedCallback` AFTER the adopt, so its
 * `ownerDocument` is already B's when it pauses (Chromium, Firefox, WebKit and jsdom). The pause set its timer on B's
 * window while the resume cleared on the window of its last connect, A's: the timer survived, fired, and tore down a
 * component that was back in the page; its writes no longer rendered. Pinned: after the pause would have expired, the
 * adopted component is still live (a write renders) and was never torn down. CONTROL: the same component left out of
 * any page past its pause IS torn down, so the wait is long enough to fire the timer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
const { define, html, wire, createStore, effect, flush } = await load('core');
const { renderer } = await load('renderer');
wire([renderer]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = async () => { flush(); await wait(0); flush(); };
let seq = 0;

const persisting = (persist) => {
  const t = `x-pa-${++seq}`;
  const s = createStore({ n: 1 });
  const c = { setups: 0, cleanups: 0 };
  define({ tag: t, persist }, () => {
    c.setups++;
    effect(() => { void s.n; return () => c.cleanups++; });
    return () => html`<b>${s.n}</b>`;
  });
  return { el: document.createElement(t), s, c };
};

test('a paused component adopted into another window and appended there outlives its pause, live', async () => {
  const other = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
  const { el, s, c } = persisting(0.1);
  document.body.append(el);
  await settle();
  other.window.document.adoptNode(el);
  other.window.document.body.append(el);
  await settle();
  await wait(250);
  s.n = 2;
  await settle();
  assert.equal(el.isConnected, true);
  assert.equal(el.textContent, '2', 'a write still renders: it was not torn down');
  assert.equal(c.setups, 1, 'never set up again');
  el.remove();
  other.window.close();
});

test('CONTROL: the same component left out of any page past its pause is torn down', async () => {
  const { el, s, c } = persisting(0.1);
  document.body.append(el);
  await settle();
  el.remove();
  await wait(250);
  s.n = 2;
  await settle();
  assert.equal(el.textContent, '1', 'torn down: the write does not render');
  assert.ok(c.cleanups >= 1);
});

test('a component whose async setup is still PENDING, adopted into another window and appended there, outlives the bound, live', async () => {
  const other = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
  const t = `x-pa-${++seq}`;
  const s = createStore({ n: 1 });
  let setups = 0;
  let release;
  const gate = new Promise((r) => (release = r));
  define(t, async () => {
    setups++;
    await gate;
    return () => html`<b>${s.n}</b>`;
  });
  const el = document.createElement(t);
  document.body.append(el);
  await settle();
  other.window.document.adoptNode(el);
  other.window.document.body.append(el);
  await settle();
  /** The setup settles soon after, in B, as a real one does: the component is live (CONTROL). */
  release();
  await settle();
  assert.equal(el.textContent, '1', 'CONTROL: its setup committed in B');
  /** Past the pending bound (5 s), where a timer left on the wrong window fires and tears the live component down. */
  await wait(5100);
  s.n = 2;
  await settle();
  assert.equal(el.isConnected, true);
  assert.equal(el.textContent, '2', 'a write still renders: it was not torn down at the bound');
  assert.equal(setups, 1, 'one setup');
  el.remove();
  other.window.close();
});
