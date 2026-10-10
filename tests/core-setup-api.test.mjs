/**
 * **R1 — `init(host, setup?)` / `init({ host, …options }, setup?)` and the setup that returns its render** (Phase 1 of the
 * 2026-10-10 roadmap; plan: the portal's PHASE1-R1-PLAN). One form: a component's function is a SETUP that runs once,
 * untracked, inside `init`'s call — the window is the call, so it ends exactly when the setup returns or throws — and
 * returns its RENDER function. The element is `host`, the setup's first parameter. Options travel with the host in one
 * object (`{ host, shadow }`), so the setup is always the second argument.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet', 'cancelAnimationFrame', 'ShadowRoot'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);

const core = await load('core');
const { renderer } = await load('renderer');
core.wire([renderer]);
const { init, html, createStore, useEffect, flush } = core;
const doc = dom.window.document;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
let seq = 0;
/** Red against today's core on purpose — each row's own assertion (piece 1); piece 2's commit flips them. */
const TODO = { todo: 'R1 piece 2: init(host, setup) and the setup that returns its render' };
const name = () => `x-setup-${seq++}`;

/** Every console line while `run` runs. */
const listen = async (run) => {
  const said = [];
  const saved = { warn: console.warn, error: console.error };
  console.warn = (...a) => said.push(`warn ${a.join(' ')}`);
  console.error = (...a) => said.push(`error ${a.join(' ')}`);
  try { await run(); } finally { Object.assign(console, saved); }
  return said;
};
/** A component class whose `connectedCallback` is `connect(this)`. */
const component = (connect) => {
  const tag = name();
  customElements.define(tag, class extends HTMLElement { connectedCallback() { connect(this); } });
  return tag;
};
const mount = async (tag, parent = doc.body) => {
  const el = doc.createElement(tag);
  parent.append(el);
  await tick();
  return el;
};

test('the setup runs once, its render on every change — setup ×1, render ×1 at connect', TODO, async () => {
  const state = createStore({ n: 0 });
  let setups = 0;
  let renders = 0;
  const tag = component((host) => init(host, () => {
    setups++;
    return () => { renders++; return html`<p>${state.n}</p>`; };
  }));
  const el = await mount(tag);
  assert.deepEqual([setups, renders], [1, 1], 'one call each at connect');
  assert.equal(el.textContent, '0');
  state.n = 1;
  await tick();
  assert.deepEqual([setups, renders], [1, 2], 'a change re-runs the render only');
  assert.equal(el.textContent, '1');
});

test('the setup receives its element as `host`', TODO, async () => {
  let seen = null;
  const tag = component((host) => init(host, (h) => { seen = h; return () => html`<i></i>`; }));
  const el = await mount(tag);
  assert.ok(seen === el);
});

test('a setup is UNTRACKED: a read in it re-renders neither the parent that connected it nor the component itself', TODO, async () => {
  const shared = createStore({ v: 1 });
  let childRenders = 0;
  let parentRenders = 0;
  const child = component((host) => init(host, () => {
    const initial = shared.v; // a setup-only read
    return () => { childRenders++; return html`<b>${initial}</b>`; };
  }));
  const parent = component((host) => init(host, () => () => {
    parentRenders++;
    return html`<div>${doc.createElement(child)}</div>`;
  }));
  await mount(parent);
  assert.ok(parentRenders === 1 && childRenders === 1, `CONTROL: both rendered once (${parentRenders}, ${childRenders}) — or this row measures nothing`);
  const before = [parentRenders, childRenders];
  shared.v = 2;
  await tick();
  assert.deepEqual([parentRenders, childRenders], before, 'nothing re-rendered for a setup-only read');
  shared.v = 3;
  await tick();
  assert.deepEqual([parentRenders, childRenders], before, 'still nothing — the read subscribed no one');
});

test('the window is the call: a hook outside a setup has no owner — after a return and after a throw', TODO, async () => {
  const tag = component((host) => init(host, () => () => html`<i></i>`));
  await mount(tag);
  assert.throws(() => useEffect(() => {}), /no-owner/, 'after the setup returned, no component is being set up');
  let called = 0;
  const failing = component((host) => {
    try { init(host, () => { called++; throw new Error('setup boom'); }); } catch { /* the author's own call failed */ }
  });
  await mount(failing);
  assert.equal(called, 1, 'CONTROL: the throwing setup was actually called');
  assert.throws(() => useEffect(() => {}), /no-owner/, 'a throw closes the window too');
});

test('a setup that throws: init rethrows it; the hooks it registered never run; the next connect renders normally', TODO, async () => {
  let effects = 0;
  let fail = true;
  const thrown = [];
  const tag = component((host) => {
    try {
      init(host, () => {
        useEffect(() => { effects++; });
        if (fail) throw new Error('setup boom');
        return () => html`<p>ok</p>`;
      });
    } catch (error) { thrown.push(error.message); }
  });
  const el = await mount(tag);
  assert.deepEqual(thrown, ['setup boom'], 'rethrown from init, where the author called it');
  assert.equal(effects, 0, 'the effect registered before the throw never ran');
  fail = false;
  el.remove();
  doc.body.append(el);
  await tick();
  assert.equal(el.textContent, 'ok', 'the next connect starts clean and renders');
  assert.equal(effects, 1, 'and its effect runs once');
});

test('a nested init inside a setup restores the outer component as the owner', TODO, async () => {
  const order = [];
  const inner = doc.createElement('div');
  const tag = component((host) => init(host, () => {
    init(inner, () => { useEffect(() => order.push('inner')); return () => html`<i></i>`; });
    useEffect(() => order.push('outer')); // registered AFTER the nested init: must belong to the outer host
    return () => html`<b></b>`;
  }));
  await mount(tag);
  assert.ok(order.includes('outer'), `the outer effect ran on the outer component: ${order}`);
});

test('a hook created inside a render callback has no owner', TODO, async () => {
  let thrown = null;
  const tag = component((host) => init(host, () => () => {
    try { useEffect(() => {}); } catch (error) { thrown = error; }
    return html`<i></i>`;
  }));
  await mount(tag);
  assert.match(String(thrown?.message), /no-owner/);
});

test('a setup returning nothing is a side-effect setup: its effects run, nothing renders', TODO, async () => {
  let ran = 0;
  const tag = component((host) => init(host, () => { useEffect(() => { ran++; }); }));
  const el = await mount(tag);
  assert.equal(ran, 1);
  assert.equal(el.childNodes.length, 0);
});

for (const [kind, value] of [['a template', html`<p>static</p>`], ['a string', 'static'], ['an array', ['sta', 'tic']]])
  test(`a setup returning ${kind} renders it once, statically — the same in both builds; development says why, once`, TODO, async () => {
    const shared = createStore({ v: 1 });
    const said = await listen(async () => {
      const tag = component((host) => init(host, () => { void shared.v; return value; }));
      const one = await mount(tag);
      const two = await mount(tag);
      assert.equal(one.textContent, 'static', 'rendered');
      assert.equal(two.textContent, 'static');
      shared.v = 2;
      await tick();
      assert.equal(one.textContent, 'static', 'and never re-rendered');
    });
    const ours = said.filter((line) => line.includes('setup-returned-value'));
    if (isProduction) assert.deepEqual(ours, [], 'production is silent');
    else assert.equal(ours.length, 1, `one coded message per component class: ${said.join(' | ')}`);
  });

test('Shape B: init(host) with no function calls the class\'s setup() method, and super.setup() composes', TODO, async () => {
  const calls = [];
  class Base extends HTMLElement {
    setup() { calls.push('base'); return () => html`<p>base</p>`; }
    connectedCallback() { init(this); }
  }
  const tag = name();
  customElements.define(tag, class extends Base {
    setup(host) { calls.push('sub'); assert.ok(host === this); return super.setup(host); }
  });
  const el = await mount(tag);
  assert.deepEqual(calls, ['sub', 'base']);
  assert.equal(el.textContent, 'base');
});

test('options travel with the host: { host, shadow } — open, closed, a ShadowRootInit, and false for light', TODO, async () => {
  const open = await mount(component((host) => init({ host, shadow: 'open' }, () => () => html`<p>o</p>`)));
  assert.ok(open.shadowRoot !== null && open.shadowRoot.textContent === 'o', 'an open root, rendered into');
  const closed = await mount(component((host) => init({ host, shadow: 'closed' }, () => () => html`<p>c</p>`)));
  assert.ok(closed.shadowRoot === null && closed.textContent === '', 'a closed root: hidden, and the light DOM untouched');
  const init_ = await mount(component((host) => init({ host, shadow: { mode: 'open', delegatesFocus: true } }, () => () => html`<p>d</p>`)));
  assert.ok(init_.shadowRoot?.delegatesFocus === true, 'a ShadowRootInit passes through');
  const light = await mount(component((host) => init({ host, shadow: false }, () => () => html`<p>l</p>`)));
  assert.ok(light.shadowRoot === null && light.textContent === 'l', 'false is explicitly light DOM');
});

test('Shape B takes the same options object: init({ host: this, shadow }) finds this.setup', TODO, async () => {
  const tag = name();
  customElements.define(tag, class extends HTMLElement {
    setup() { return () => html`<p>b</p>`; }
    connectedCallback() { init({ host: this, shadow: 'open' }); }
  });
  const el = await mount(tag);
  assert.equal(el.shadowRoot?.textContent, 'b');
});

test('a shadow value the platform would not take is refused by name, then light DOM', TODO, async () => {
  const said = await listen(async () => {
    const el = await mount(component((host) => init({ host, shadow: true }, () => () => html`<p>x</p>`)));
    assert.ok(el.shadowRoot === null && el.textContent === 'x', 'the fallback: light DOM');
  });
  if (!isProduction) assert.ok(said.some((line) => line.includes('shadow-option')), `named: ${said.join(' | ')}`);
});

test('the old init(this, { mode }) is refused in development with the new spelling', TODO, async () => {
  const said = await listen(async () => {
    await mount(component((host) => { try { init(host, { mode: 'open' }); } catch (error) { console.error(error.message); } }));
  });
  if (!isProduction) assert.ok(said.some((line) => line.includes('init-options')), `named: ${said.join(' | ')}`);
});

test('a near-miss setup spelling is named once; a setup-less init and the consumer shape stay silent', TODO, async () => {
  const said = await listen(async () => {
    const typo = name();
    customElements.define(typo, class extends HTMLElement {
      setUp() { return () => html`<p></p>`; }
      connectedCallback() { init(this); }
    });
    await mount(typo);
    await mount(typo);
    await mount(component((host) => init({ host, shadow: 'open' })));
  });
  const near = said.filter((line) => line.includes('setup-near-miss'));
  if (isProduction) assert.deepEqual(near, []);
  else {
    assert.equal(near.length, 1, `once: ${said.join(' | ')}`);
    assert.match(near[0], /setUp/);
  }
});

test('an async setup: the resolved render is installed; a write while it is pending does not re-run the setup', TODO, async () => {
  const state = createStore({ n: 0 });
  let setups = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const tag = component((host) => init(host, async () => {
    setups++;
    void state.n;
    await gate;
    return () => html`<p>${state.n}</p>`;
  }));
  const el = await mount(tag);
  state.n = 1;
  await tick();
  release();
  await tick();
  await flush?.();
  assert.equal(setups, 1, 'one setup');
  assert.equal(el.textContent, '1', 'the render landed, current');
  state.n = 2;
  await tick();
  assert.equal(el.textContent, '2', 'and follows the store');
});
