/**
 * What happens to the framework when *your* code throws.
 *
 * Three questions at each point a callback of yours runs: is the throw reported, does it escape into
 * whatever triggered it, and — the one that matters — **is the framework still usable afterwards?**
 * A framework that reports an error and then quietly stops updating is indistinguishable from one
 * that works, right up until it matters.
 *
 * Every case here has a control that does the same thing without throwing, because "it still works"
 * is only meaningful against "it works".
 */
import { load, isProduction } from './dist.mjs';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import test from 'node:test';

const dom = new JSDOM('<!doctype html><body><div id="host"></div></body>', { pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event',
  'CustomEvent', 'MouseEvent',
])
  globalThis[key] = dom.window[key];

const core = await load('core');
const { html, init, render, createStore, useEffect, wire, mount: commit } = core;
const { renderer } = await load('renderer');
wire([renderer]);

const host = document.getElementById('host');
const settle = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

let seq = 0;
const define = (body, { renders = true } = {}) => {
  const tag = `x-fault-${seq++}`;
  customElements.define(
    tag,
    class extends HTMLElement {
      connectedCallback() {
        init(this, { mode: 'open' });
        body(this);
        if (!renders) commit();
      }
    }
  );
  const element = document.createElement(tag);
  host.appendChild(element);
  return element;
};

/** Collects whatever reached the console, so a deliberate throw does not spray the test output. */
const capture = async (body) => {
  const said = [];
  const { error, warn } = console;
  console.error = (...args) => said.push(args.map(String).join(' '));
  console.warn = (...args) => said.push(args.map(String).join(' '));
  try {
    await body();
  } finally {
    console.error = error;
    console.warn = warn;
  }
  return said;
};

/**
 * **A cleanup that threw killed its effect for the life of the component.**
 *
 * `invoke` opened with a bare `cleanup?.()`, so the throw took the whole call with it: the effect
 * body below never ran, `cleanup` was never replaced, and the next pass called the same throwing
 * function again. Every later write reported the same error and changed nothing.
 *
 * `swapCleanup` already guards exactly this on the disconnect path — a cleanup throwing there must
 * not stop the rest of the sweep — so the gap was the path a component spends its whole life on.
 */
test('an effect survives a cleanup that throws', async () => {
  const state = createStore({ n: 0 });
  const ran = [];
  await capture(async () => {
    define(() => useEffect(() => { ran.push(state.n); return () => { throw new Error('cleanup-boom'); }; }), { renders: false });
    await settle();
    for (const n of [1, 2, 3]) {
      state.n = n;
      await settle();
    }
  });
  assert.deepEqual(ran, [0, 1, 2, 3], 'one throwing teardown stopped the effect for good');
});

test('the control: the same effect with a cleanup that does not throw', async () => {
  const state = createStore({ n: 0 });
  const ran = [];
  define(() => useEffect(() => { ran.push(state.n); return () => {}; }), { renders: false });
  await settle();
  for (const n of [1, 2, 3]) {
    state.n = n;
    await settle();
  }
  assert.deepEqual(ran, [0, 1, 2, 3]);
});

/**
 * `cleanup = next` was the last statement in `invoke`, so a body that threw left `cleanup` holding
 * the *previous* pass's teardown — which had already run a line earlier. The next pass ran it a
 * second time.
 *
 * Invisible for a teardown that removes a listener; not invisible for one that releases a lock,
 * decrements a count or closes a socket. And it happens only while something else is already going
 * wrong, which is where it is least likely to be noticed.
 */
test('a cleanup runs exactly once per setup, even when the effect body throws', async () => {
  const state = createStore({ n: 0 });
  const log = [];
  await capture(async () => {
    define(() => useEffect(() => {
      const at = state.n;
      log.push(`setup ${at}`);
      if (at === 1) throw new Error('body-boom');
      return () => log.push(`cleanup ${at}`);
    }), { renders: false });
    await settle();
    for (const n of [1, 2, 3]) {
      state.n = n;
      await settle();
    }
  });
  const cleanups = log.filter((line) => line.startsWith('cleanup'));
  assert.deepEqual(cleanups, [...new Set(cleanups)], `a teardown ran twice: ${log.join(', ')}`);
  /** And the setup that threw registered no teardown at all, because it never finished. */
  assert.ok(!cleanups.includes('cleanup 1'), 'a setup that threw should own no teardown');
});

/**
 * **A ref that threw emptied the component and it never rendered again.**
 *
 * A ref runs in the middle of committing a template's parts, so the throw unwound the render that
 * triggered it and left the commit half applied: the shadow root ended up empty and stayed that way,
 * and every later update threw at the same line. The error *was* reported, so the only symptom was a
 * component that had silently stopped existing.
 */
test('a component survives a ref callback that throws', async () => {
  const state = createStore({ n: 0 });
  let element;
  const said = await capture(async () => {
    element = define(() => render(() => html`<i ${() => { throw new Error('ref-boom'); }}>${state.n}</i>`));
    await settle();
    state.n = 4;
    await settle();
  });
  assert.equal(element.shadowRoot.textContent.trim(), '4', 'the component stopped rendering');
  if (!isProduction)
    assert.ok(
      said.some((line) => line.startsWith('[vera]') && /ref/.test(line)),
      `the throw was not named as a ref: ${JSON.stringify(said.slice(0, 2))}`
    );
});

test('the control: the same component with a ref that does not throw', async () => {
  const state = createStore({ n: 0 });
  const element = define(() => render(() => html`<i ${() => {}}>${state.n}</i>`));
  await settle();
  state.n = 4;
  await settle();
  assert.equal(element.shadowRoot.textContent.trim(), '4');
});

/** The rest of the fault surface, which was already right and is asserted so it stays that way. */
test('a component recovers when its template function throws', async () => {
  const state = createStore({ n: 0, fail: true });
  let element;
  await capture(async () => {
    element = define(() => render(() => {
      if (state.fail) throw new Error('render-boom');
      return html`<i>${state.n}</i>`;
    }));
    await settle();
  });
  state.fail = false;
  state.n = 5;
  await settle();
  assert.equal(element.shadowRoot.textContent.trim(), '5', 'a first render that threw was never retried');
});

test('a throwing effect does not stop the next effect on the same component', async () => {
  const state = createStore({ n: 0 });
  let after = 0;
  await capture(async () => {
    define(() => {
      useEffect(() => { void state.n; throw new Error('effect-boom'); });
      useEffect(() => { void state.n; after++; });
    }, { renders: false });
    await settle();
  });
  assert.ok(after > 0, 'the second effect never ran');
  const was = after;
  await capture(async () => {
    state.n = 1;
    await settle();
  });
  assert.ok(after > was, 'later writes stopped reaching the surviving effect');
});

test('a component whose setup throws does not break the next component', async () => {
  await capture(async () => {
    const tag = `x-fault-bad-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      connectedCallback() { init(this, { mode: 'open' }); throw new Error('setup-boom'); }
    });
    host.appendChild(document.createElement(tag));
    await settle();
  });
  const state = createStore({ n: 1 });
  const good = define(() => render(() => html`<i>${state.n}</i>`));
  await settle();
  assert.equal(good.shadowRoot.textContent.trim(), '1');
  state.n = 2;
  await settle();
  assert.equal(good.shadowRoot.textContent.trim(), '2');
});
