/**
 * **A run nested inside its own run never loses the outer run's links** (2026-10-22). A raw hook or a `'sync'` effect runs
 * INSIDE the write that wakes it, so one that writes a key it read re-runs inside its own run. A callback that guards
 * against that re-entrancy (`if (busy) return` — legitimate: the echo is redundant) makes the nested run read NOTHING;
 * reconciling the hook's links to that empty run unlinked every source the outer run had read, and the hook went deaf.
 * Found as `data-vd-list` writing its `counts` back (directives-query, red since the per-key cells engine). The rows hold
 * it in core, with a plain-object owner, so it cannot hide behind one package's suite again. Counts exact, each with a
 * control.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
const core = await load('core');
const { createStore, effect } = core;
/** Core's raw hook, taken once: a second core copy in development overwrites the seam. */
const createHook = core.inserts.$s[2];

/** A callback that reads `q` and `tag`, writes `counts` (which it also reads), and returns early when re-entered. */
const guarded = (s, log) => {
  let busy = false;
  return () => {
    if (busy) { log.echoes++; return; }
    busy = true;
    try {
      log.runs++;
      void s.tag;
      const n = s.q.length;
      if (s.counts.n !== n) s.counts = { n };
    } finally {
      busy = false;
    }
  };
};

test('a raw hook re-entered by its own write keeps hearing what its outer run read', async () => {
  const s = createStore({ q: '', tag: '', counts: { n: -1 } });
  const log = { runs: 0, echoes: 0 };
  const run = createHook({ callback: guarded(s, log), priority: 20, element: {} });
  run(undefined, true);
  assert.equal(log.echoes, 1, 'CONTROL: its own write re-entered it once');
  assert.equal(s.counts.n, 0, 'CONTROL: it wrote');
  const before = log.runs;
  s.q = 'ber';
  assert.equal(log.runs - before, 1, 'an outside write to q still runs it');
  assert.equal(s.counts.n, 3, 'and it saw the new value');
  s.tag = 'x';
  assert.equal(log.runs - before, 2, 'and one to tag');
});

test("a 'sync' effect re-entered by its own write keeps hearing what its outer run read", async () => {
  const s = createStore({ q: '', tag: '', counts: { n: -1 } });
  const log = { runs: 0, echoes: 0 };
  const owner = {};
  const fx = effect(guarded(s, log), { timing: 'sync', owner });
  fx.run();
  assert.equal(log.echoes, 1, 'CONTROL: its own write re-entered it once');
  const before = log.runs;
  s.q = 'ber';
  assert.equal(log.runs - before, 1, 'an outside write to q still runs it');
  s.tag = 'x';
  assert.equal(log.runs - before, 2, 'and one to tag');
  fx.stop();
  s.q = 'stop';
  assert.equal(log.runs - before, 2, 'CONTROL: stopped, nothing runs it');
});

/** Bounded: before the fix this shape LOOPED (a cursor left at 0 relinked and re-woke the hook inside its own write). */
test('a nested run that reads MORE than its outer run links the extra key too (the over-subscription side)', { timeout: 5000 }, async () => {
  const s = createStore({ a: 0, b: 0, w: 0 });
  let runs = 0;
  let depth = 0;
  const run = createHook({
    callback: () => {
      /** Outer runs only: every outer run writes `w` and so re-enters once, by design. */
      if (depth === 0) runs++;
      depth++;
      void s.a;
      if (depth === 1) s.w = s.w + 1;
      else void s.b;
      depth--;
    },
    priority: 20,
    element: {},
  });
  void s.w;
  run(undefined, true);
  const before = runs;
  s.b = 1;
  assert.equal(runs - before, 1, 'the key only the nested run read wakes it');
  s.a = 1;
  assert.equal(runs - before, 2, 'and the outer run’s key still does');
});

/**
 * **…and never links a key TWICE** (vera-5a, 2026-10-22). After the nested run, the outer run read `q` again while
 * ANOTHER hook was `q`'s last reader: a second link to `q`, so each write to it ran A twice — a sync effect with a side
 * effect fires twice per write. Exact runs per write, with the sharing reader that exposes it and a control without it.
 */
const sharing = (withReader) => {
  const s = createStore({ q: 0, tag: 0, counts: { n: -1 } });
  let runs = 0;
  let busy = false;
  const a = effect(() => {
    if (busy) return;
    busy = true;
    try {
      runs++;
      void s.q;
      if (s.counts.n !== s.q) s.counts = { n: s.q };
      void s.tag;
      void s.q;
    } finally {
      busy = false;
    }
  }, { timing: 'sync', owner: {} });
  const b = withReader ? effect(() => { void s.q; }, { timing: 'sync', owner: {} }) : undefined;
  a.run();
  b?.run();
  const before = runs;
  for (let i = 1; i <= 20; i++) s.q = i;
  const per = (runs - before) / 20;
  a.stop();
  b?.stop();
  return per;
};

test('a nested run never links a key twice: exactly one run per write, with another reader of the same key', () => {
  assert.equal(sharing(false), 1, 'CONTROL: alone, one run per write');
  assert.equal(sharing(true), 1, 'with a second reader of q, still one run per write');
});

test('every OTHER hook still hears each change it read, as before: a third reader of q and counts gets both per write', () => {
  const s = createStore({ q: 0, tag: 0, counts: { n: -1 } });
  let busy = false;
  const heard = [];
  const owner = {};
  const a = effect(() => {
    if (busy) return;
    busy = true;
    try { void s.q; if (s.counts.n !== s.q) s.counts = { n: s.q }; void s.tag; void s.q; } finally { busy = false; }
  }, { timing: 'sync', owner });
  const b = effect(() => { void s.q; }, { timing: 'sync', owner });
  const c = effect((change) => { void s.q; void s.counts; if (change && change !== true) heard.push(change.prop); }, { timing: 'sync', owner });
  a.run(); b.run(); c.run();
  heard.length = 0;
  for (let i = 1; i <= 10; i++) s.q = i;
  assert.equal(heard.length, 20, 'two deliveries per write (the release baseline measures the same)');
  assert.deepEqual([...new Set(heard)].sort(), ['counts', 'q'], 'one for each key it read');
  a.stop(); b.stop(); c.stop();
});
