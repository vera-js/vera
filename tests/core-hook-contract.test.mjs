/**
 * **The hook contract — `createHook`'s and the effects' — held by checks that fail without it.**
 *
 * Found by the lean rebuild's mutation controls (2026-09-27): taking priority ordering or init
 * generations out of `createHook` turned nothing in the whole suite red, because every existing test
 * registered hooks in the order their priorities already implied, and no test wrote to a store after
 * a reconnect through a hook that could still run. Both are public behavior — "lower runs earlier",
 * and "a reconnect retires the previous connection's hooks", which `@verajs/directives` uses as its
 * teardown — so each is pinned here in the shape that distinguishes it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'requestAnimationFrame', 'cancelAnimationFrame',
])
  globalThis[key] = dom.window[key];

const nextFrame = () => new Promise((resolve) => dom.window.requestAnimationFrame(resolve));

const core = await load('core');

const element = () => {
  const el = document.createElement('div');
  document.body.append(el);
  return el;
};

/**
 * Registered in the OPPOSITE order to their priorities, so insertion order and priority order
 * disagree — the only shape in which ordering by priority is observable at all.
 */
test('hooks run by priority, not by registration order', () => {
  const el = element();
  const order = [];
  core.init(el);
  core.createHook({ priority: 60, callback: () => order.push('sixty') });
  core.createHook({ priority: 0, callback: () => order.push('zero') });
  core.createHook({ priority: 25, callback: () => order.push('twenty-five') });
  core.render(() => null);
  assert.deepEqual(order, ['zero', 'twenty-five', 'sixty'], 'lower priority first, whatever the registration order');
});

/**
 * A reconnect runs `init()` again. The previous connection's hooks are still subscribed — the store
 * holds them weakly and nothing has collected them — so without generations the write below ran the
 * retired hook as well: every reconnect doubled a component's effects.
 */
test('a reconnect retires the previous connection\'s hooks', () => {
  const el = element();
  const state = core.createStore({ n: 0 });
  let runs = 0;
  core.init(el);
  core.createHook({ priority: 75, callback: () => void (state.n, runs++) });
  core.render(() => null);
  assert.equal(runs, 1, 'CONTROL: the first pass ran and subscribed');

  core.init(el);
  core.render(() => null);
  state.n = 1;
  assert.equal(runs, 1, 'the retired hook did not run on a write');
});

/** The same mechanism, used deliberately: an owner bumps `_$g$` to retire its hooks as teardown. */
test('bumping an owner\'s generation retires its hooks', () => {
  const owner = {};
  const state = core.createStore({ n: 0 });
  let runs = 0;
  const hook = core.createHook({ element: owner, priority: 30, callback: () => void (state.n, runs++) });
  hook(undefined, true);
  state.n = 1;
  assert.equal(runs, 2, 'CONTROL: live, the hook re-runs on a write');

  owner._$g$ = (owner._$g$ ?? 0) + 1;
  state.n = 2;
  assert.equal(runs, 2, 'retired, it does not');
});

/**
 * **A write an effect makes to state it read schedules its next run — it does not recurse into one.**
 * The deferred run re-enters through the hook with a flag raised for that one call; the flag must be
 * lowered before the effect body runs, or the body's own write finds it still raised and runs the
 * effect again synchronously, inside itself — every step of a settling loop at once, and a
 * self-feeding one straight into a stack overflow instead of the paced loop the render-loop guard is
 * built to catch. And the scheduler's rule (2026-10-08): a hook runs at most TWICE in one flush — a
 * measure-then-set lands before paint — and a third run waits for the next frame. Pinned step by step.
 */
test('an effect that writes what it read steps twice per flush, then a frame, rather than recursing', async () => {
  const el = element();
  const state = core.createStore({ go: false, n: 0 });
  let runs = 0;
  core.init(el);
  core.useEffect(() => {
    runs++;
    if (state.go && state.n < 3) state.n++;
  });
  core.mount();
  assert.equal(runs, 1, 'CONTROL: the first pass ran');
  state.go = true;
  assert.equal(state.n, 0, 'the write queued a run — nothing ran inside it');
  await Promise.resolve();
  assert.equal(state.n, 2, 'two steps in the flush, not all three: the third run waits for the frame');
  await nextFrame();
  await nextFrame();
  assert.equal(state.n, 3, 'and it settles on the frame');
});

/**
 * **A coalesced pass runs with the signal of the write that queued it.** The scheduled run is one
 * closure per hook, reused across updates, so the signal travels beside it rather than being captured
 * per update — this pins that it still arrives: the property written and its value.
 */
test('a coalesced effect receives the signal of the write that queued it', async () => {
  const el = element();
  core.init(el);
  const state = core.createStore({ n: 0 });
  const seen = [];
  core.useEffect((signal) => {
    void state.n;
    seen.push(signal?.prop === undefined ? 'init' : `${signal.prop}=${signal.value}`);
  });
  core.mount();
  state.n = 5;
  await nextFrame();
  assert.deepEqual(seen, ['init', 'n=5'], 'the queued pass carried the write that scheduled it');
});
