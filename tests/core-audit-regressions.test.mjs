/**
 * Regressions found in the 2026-08-25 full-framework audit. Each is a general fix, not a patch for
 * the one shape that surfaced it, and each of these failed before the fix.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element'])
  globalThis[key] = dom.window[key];

const core = await load('core');

/* ── falsy-but-legal values ──────────────────────────────────────────────────────────────────── */

/**
 * `0` is a legal CSS value and a falsy one. `values[i] || ''` dropped it, so `margin: ${0}px`
 * produced `margin: px` — a declaration the parser discards, losing the property with no error.
 * Every zero out of a computed layout hit this.
 */
test('css interpolates a zero', () => {
  const { cssText } = core.css`margin: ${0}px; z-index: ${0}; opacity: ${0.5}`;
  assert.equal(cssText, 'margin: 0px; z-index: 0; opacity: 0.5');
});

/** An empty string is the one value that should still vanish. */
test('css interpolates an empty string as nothing', () => {
  assert.equal(core.css`a: ${''}b`.cssText, 'a: b');
});

/**
 * Priority `0` is the *earliest* priority, so it is the obvious choice for a hook that must run
 * before everything else — and a falsy guard rejected exactly that value, registering nothing.
 */
test('a hook at priority 0 registers and runs', async () => {
  const el = document.createElement('div');
  document.body.append(el);
  core.init(el, { mode: 'open' });
  const state = core.createStore({ n: 0 });
  const order = [];
  core.createHook({ element: el, priority: 0, callback: () => order.push(`zero:${state.n}`) });
  core.createHook({ element: el, priority: 10, callback: () => order.push(`ten:${state.n}`) });

  const hook = core.createHook({ element: el, priority: 5, callback: () => {} });
  assert.equal(typeof hook, 'function', 'createHook must hand back its wrapper');

  el._hooks?.forEach((set) => set.forEach((cb) => cb(undefined, true)));
  assert.deepEqual(order, ['zero:0', 'ten:0'], 'priority 0 runs, and runs first');

  order.length = 0;
  state.n = 1;
  await new Promise((r) => dom.window.requestAnimationFrame(r));
  assert.deepEqual(order, ['zero:1', 'ten:1'], 'and its dependency was tracked');
});

/** `NaN` is what `parseInt` of a config value produces, and it is the case that must be refused. */
test('a hook with a non-finite priority is refused', () => {
  const el = document.createElement('div');
  document.body.append(el);
  core.init(el, { mode: 'open' });
  assert.equal(core.createHook({ element: el, priority: NaN, callback: () => {} }), undefined);
});

/* ── write suppression is per property, not process-wide ─────────────────────────────────────── */

/**
 * `Reflect.set` with the proxy as receiver re-enters `defineProperty`, so that one re-entry must be
 * ignored or every write notifies twice. Recognising it by a *depth counter* meant any write in
 * flight suppressed every definition anywhere: a setter that defined a property — a different key,
 * or a key on an entirely different store — notified nobody, and nothing connected the two.
 */
test('defineProperty inside a setter still notifies', async () => {
  const el = document.createElement('div');
  document.body.append(el);
  core.init(el, { mode: 'open' });

  const other = core.createStore({ shadow: 0 });
  const state = core.createStore({
    set trigger(v) {
      Object.defineProperty(other, 'shadow', { value: v, configurable: true, enumerable: true });
    },
    trigger_: 0,
  });

  const seen = [];
  core.createHook({ element: el, priority: 50, callback: () => seen.push(other.shadow) });
  el._hooks?.forEach((set) => set.forEach((cb) => cb(undefined, true)));
  assert.deepEqual(seen, [0], 'the hook read the initial value');

  state.trigger = 7;
  await new Promise((r) => dom.window.requestAnimationFrame(r));
  assert.deepEqual(seen, [0, 7], 'the definition made during the write was reported');
});

/** The re-entry it does exist for must still be suppressed — one notification, not two. */
test('an ordinary assignment notifies exactly once', async () => {
  const el = document.createElement('div');
  document.body.append(el);
  core.init(el, { mode: 'open' });
  const state = core.createStore({ n: 0 });
  let runs = 0;
  core.createHook({
    element: el,
    priority: 50,
    callback: () => {
      void state.n;
      runs++;
    },
  });
  el._hooks?.forEach((set) => set.forEach((cb) => cb(undefined, true)));
  runs = 0;
  state.n = 1;
  await new Promise((r) => dom.window.requestAnimationFrame(r));
  assert.equal(runs, 1, 'one write, one run');
});

/* ── the hot-path chain cache ────────────────────────────────────────────────────────────────── */

/**
 * `'proxy-handler'` and `'set-handler'` are cached against the registry's revision, because reading
 * them from the Map on every property access cost 13% of a tracked read. The cache has exactly one
 * way to be wrong: a chain wired *after* the first read must still be picked up.
 */
test('a proxy-handler wired after the first read is still seen', async () => {
  /** Core's own `wire`, which writes to the registry core reads — see the note in `tests/dist.mjs`. */
  const { wire } = core;
  const state = core.createStore({ n: 1 });
  assert.equal(state.n, 1, 'read once, so the empty chain is cached');

  const seen = [];
  wire({ on: 'proxy-handler', fn: (obj, prop, value) => (seen.push(prop), value), priority: 41 });
  void state.n;
  assert.ok(seen.includes('n'), 'the newly wired handler ran');

  /** And replacing at a taken priority — which mutates the chain in place — still takes effect. */
  const later = [];
  wire({ on: 'proxy-handler', fn: (obj, prop, value) => (later.push(prop), value), priority: 41 });
  void state.n;
  assert.ok(later.includes('n'), 'the replacement ran');
});

test('a set-handler wired after the first write is still seen', async () => {
  const { wire } = core;
  const state = core.createStore({ n: 0 });
  state.n = 1;

  const writes = [];
  wire({ on: 'set-handler', fn: (obj, prop) => void writes.push(prop), priority: 42 });
  state.n = 2;
  assert.deepEqual(writes, ['n'], 'the newly wired handler ran');
});

/* ── runaway useSyncEffect ───────────────────────────────────────────────────────────────────── */

/**
 * `useSyncEffect` runs on every individual change, so an unguarded write to state it also reads
 * feeds itself. That is inherent — Solid and Preact carry it too — but running it to a stack
 * overflow reports the trap rather than the cause. Development stops it at depth 50 and names it.
 */
test('a self-feeding useSyncEffect is stopped and named in development', async () => {
  const { isProduction } = await import('./dist.mjs');
  const el = document.createElement('div');
  document.body.append(el);
  core.init(el, { mode: 'open' });
  const state = core.createStore({ n: 0 });

  const errors = [];
  const nativeError = console.error;
  console.error = (...args) => errors.push(String(args[0]));
  try {
    core.useSyncEffect(() => {
      state.n = state.n + 1;
    }, el);
    el._hooks?.forEach((set) => set.forEach((cb) => cb(undefined, true)));
  } catch (error) {
    if (isProduction) return; // production has no guard; a stack overflow here is the documented cost
    throw error;
  } finally {
    console.error = nativeError;
  }

  if (isProduction) return;
  assert.ok(
    errors.some((m) => m.includes('re-entered') && m.includes('useEffect')),
    'it must name the hook, the cause and the alternative'
  );
});

/* ── stores over unusual targets ─────────────────────────────────────────────────────────────── */

/**
 * A frozen or sealed object is an ordinary thing to hand a store — a config, a constant table, a
 * payload frozen by whatever produced it. `createStore` defined a `_delete` convenience on the raw
 * target unconditionally, so a frozen one threw `Cannot define property _delete, object is not
 * extensible`: a failure naming a property the author never wrote.
 */
test('a frozen store is accepted and still reads', () => {
  const frozen = core.createStore(Object.freeze({ a: 1, nested: { b: 2 } }));
  assert.equal(frozen.a, 1);
  assert.equal(frozen.nested.b, 2);
  assert.equal(frozen._delete, undefined, 'no _delete on a store that cannot change');
});

test('a sealed store still notifies on a write to an existing key', async () => {
  const el = document.createElement('div');
  document.body.append(el);
  core.init(el, { mode: 'open' });
  const state = core.createStore(Object.seal({ n: 0 }));
  const seen = [];
  core.createHook({ element: el, priority: 50, callback: () => seen.push(state.n) });
  el._hooks?.forEach((set) => set.forEach((cb) => cb(undefined, true)));
  state.n = 1;
  await new Promise((r) => dom.window.requestAnimationFrame(r));
  assert.deepEqual(seen, [0, 1]);
});

/**
 * Proxying one object twice produced two proxies with separate nested caches, so the same nested
 * object read through each was two different values. Subscriptions were shared — they key off the
 * raw target — which made the divergence identity-only, and therefore quiet.
 */
test('proxying the same object twice returns the same proxy', () => {
  const raw = { user: { id: 1 } };
  assert.equal(core.createStore(raw), core.createStore(raw));
  const a = core.createStore(raw);
  const b = core.createStore(raw);
  assert.equal(a.user, b.user, 'and nested identity agrees across them');
});

/**
 * The same invariant an extensible object can still hit: a property defined non-writable *and*
 * non-configurable must be returned verbatim by the `get` trap. Caught on the cache-miss path, so
 * the hot path never pays for it — the exact per-read descriptor check measured at +38% on a
 * two-hop read.
 */
test('an explicitly readonly nested property is returned verbatim', () => {
  const raw = {};
  const inner = { b: 1 };
  Object.defineProperty(raw, 'locked', { value: inner, writable: false, configurable: false, enumerable: true });
  const state = core.createStore(raw);
  assert.equal(state.locked, inner, 'the raw object, not a proxy — the engine requires it');
  assert.equal(state.locked.b, 1);
});

/** A frozen owner still tracks its own keys; only substitution is forbidden. */
test('a frozen store still reports its shape', () => {
  const state = core.createStore(Object.freeze({ a: 1, b: 2 }));
  assert.deepEqual(Object.keys(state), ['a', 'b']);
  assert.ok('a' in state);
});
