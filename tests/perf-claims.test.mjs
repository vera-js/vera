/**
 * The performance claims the **code** makes about itself, asserted as ratios.
 *
 * `CLAUDE.md` records that the only numbers in this repo which never drifted are the size claims,
 * because `sync-size-claims.mjs --check` stands behind them. The cost figures written into source
 * comments have no such generator, and pass 91 found exactly what that predicts: a tracked read is
 * 59 ns where the comment says 131, a write 389 where it says 865, and the deep-store penalty is
 * ~300x where the comment says 63x. Every absolute had drifted; the machine is simply faster.
 *
 * **The ratios had not drifted at all** — read-to-write was 6.6x then and 6.6x now — which is the
 * tell: a ns/op figure is a property of the machine, and the ratio is the property of the design.
 * So the ratios are what get asserted here, with wide margins, because the purpose is to catch a
 * *structural* regression and never to police a number.
 *
 * Deliberately no absolute thresholds. A test that fails because CI is slow teaches people to
 * re-run it, and a test people re-run is not a gate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<body></body>', { pretendToBeVisual: true });
for (const key of ['document', 'HTMLElement', 'Node', 'Element', 'customElements', 'DocumentFragment',
                   'Text', 'Comment', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event'])
  globalThis[key] = dom.window[key];

const core = await load('core');
const { renderInto } = await load('renderer');
core.wire({ on: 'render', fn: renderInto, priority: 50 });

/** Fastest of several rounds: noise here is one-sided, so the minimum is the honest statistic. */
const best = (fn, reps, rounds = 7) => {
  let fastest = Infinity;
  for (let round = 0; round < rounds; round++) {
    const started = performance.now();
    for (let i = 0; i < reps; i++) fn(i);
    fastest = Math.min(fastest, ((performance.now() - started) * 1e6) / reps);
  }
  return fastest;
};

/**
 * The best **ratio** of two costs, measured in the same round.
 *
 * `best(a)` then `best(b)` takes the minimum of each *independently*, which is the right statistic
 * for either one alone and the wrong one for their ratio. The two are not equally fragile: the
 * cheaper measurement is short enough that a single scheduling preemption dominates its minimum,
 * while the dearer one absorbs the same interruption. So under load the *fast* side inflates and the
 * ratio collapses — this claim measures ~300x on a quiet machine and was seen at **16.9x and 14.7x**
 * during full gate runs, twice failing an assertion set at 20x while passing every time it was
 * re-run alone.
 *
 * Timing both inside one round makes them see the same machine, and taking the best ratio across
 * rounds picks the least-contended pair rather than combining two unrelated minima. The assertion is
 * unchanged: a real 20x is still required.
 */
const bestRatio = (dear, cheap, reps, rounds = 7) => {
  let ratio = 0;
  let sample = [0, 0];
  for (let round = 0; round < rounds; round++) {
    const dearStarted = performance.now();
    for (let i = 0; i < reps; i++) dear(i);
    const dearCost = (performance.now() - dearStarted) * 1e6;

    const cheapStarted = performance.now();
    for (let i = 0; i < reps; i++) cheap(i);
    const cheapCost = (performance.now() - cheapStarted) * 1e6;

    if (cheapCost > 0 && dearCost / cheapCost > ratio) {
      ratio = dearCost / cheapCost;
      sample = [dearCost / reps, cheapCost / reps];
    }
  }
  return { ratio, dear: sample[0], cheap: sample[1] };
};

/** Accumulated into a global so nothing can be optimised away as unused. */
globalThis.__perfSink = 0;
const walk = (list) => {
  let sum = 0;
  for (const row of list) sum += row.id + row.label.length;
  globalThis.__perfSink += sum;
};

test('a deep store is far more expensive to walk than a shallowRef, which is why the docs say so', () => {
  const rows = () => Array.from({ length: 1000 }, (_, i) => ({ id: i, label: `row ${i}` }));
  const deep = core.createStore({ rows: rows() });
  const shallow = core.shallowRef(rows());

  const { ratio, dear: deepCost, cheap: shallowCost } = bestRatio(
    () => walk(deep.rows),
    () => walk(shallow.value),
    200
  );

  /**
   * Measured at ~300x. Asserted at 20x, which is far enough below to survive any machine and far
   * enough above 1x to fail loudly if `_ignore` ever stops being honoured — which it did once
   * before, when only the returned value was checked and never the owner, and `shallowRef` silently
   * did nothing at all.
   */
  assert.ok(
    ratio > 20,
    `a deep store should be far costlier to walk than a shallowRef; measured ${ratio.toFixed(1)}x ` +
      `(deep ${deepCost.toFixed(0)} ns/row, shallow ${shallowCost.toFixed(0)} ns/row). ` +
      `If this dropped, shallowRef has stopped being shallow.`
  );
});

test('a hook that re-runs thousands of times does not make writes progressively slower', () => {
  customElements.define('x-perf-claims', class extends HTMLElement {
    connectedCallback() {
      core.init(this, { mode: 'open' });
      const state = core.createStore({ n: 0 });
      this._state = state;
      core.useSyncEffect(() => { void state.n; });
      core.render(() => core.html`<p>${state.n}</p>`);
    }
  });
  const element = dom.window.document.createElement('x-perf-claims');
  dom.window.document.body.appendChild(element);

  const writes = (reps) => best((i) => { element._state.n = i; }, reps, 3);
  writes(2000);                                            // warm, so JIT is not read as degradation
  const early = writes(2000);
  for (let i = 0; i < 20000; i++) element._state.n = i;    // the re-runs the comment describes
  const late = writes(2000);

  /**
   * The defect this guards ran away by **1810x** — a fresh `WeakRef` per invocation meant the
   * dependency `Set` never deduped and every write walked all of it. Asserted at 4x, which no
   * healthy build approaches (measured flat, and faster late than early once warm) and which a
   * genuine unbounded growth blows through immediately.
   *
   * Measuring one before/after pair is not enough on its own and reported 2.94x when the fix was
   * perfectly intact — the first sample was simply cold. Hence the warm-up above.
   */
  assert.ok(
    late / early < 4,
    `writes should not degrade as a hook re-runs; measured ${(late / early).toFixed(2)}x ` +
      `(${early.toFixed(0)} ns → ${late.toFixed(0)} ns after 20 000 re-runs). ` +
      `If this grew, a per-invocation WeakRef has come back and the dependency Set has stopped deduping.`
  );
});

test('a tracked read stays cheaper than a write, which is why the read chain is cached and the write chain is not', () => {
  const store = core.createStore({ a: 1 });
  const read = best(() => { globalThis.__perfSink += store.a; }, 200000);
  let n = 0;
  const write = best(() => { store.a = n++; }, 50000);
  /**
   * The `'proxy-handler'` chain is cached for reads and deliberately not for writes, and the comment
   * justifying that rests on a write costing several times a read. Measured 6.6x when written and
   * 6.6x now — the absolutes moved, the ratio did not.
   */
  assert.ok(
    write / read > 2,
    `a write should cost several times a tracked read; measured ${(write / read).toFixed(1)}x ` +
      `(read ${read.toFixed(0)} ns, write ${write.toFixed(0)} ns). If they converged, the reasoning for ` +
      `caching the read chain and not the write chain no longer holds.`
  );
});
