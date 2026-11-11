/**
 * **`computed`'s rows** (2026-10-31, Brian's hard condition on moving it into `@verajs/store`: raced against the current
 * build's in-core computed). The same workloads over the public API for every arm: `core.computed` where core still has
 * it, the store entry's otherwise (the page hands it in). Reps come from the caller (calibrated once on the base arm) or
 * are calibrated warm with a 2× margin; a sample is ≥ 50 ms. A computed's release waits for a microtask in BOTH builds,
 * so a sync loop defers it alike.
 */
const sink = { v: 0 };
const measure = (now, fn, fixed) => {
  let reps = fixed ?? 1;
  if (fixed === undefined) {
    for (let i = 0; i < 3; i++) fn();
    for (;;) { const t = now(); for (let i = 0; i < reps; i++) fn(); if (now() - t >= 50 || reps >= 1 << 20) break; reps *= 2; }
    reps *= 2;
  }
  for (let w = 0; w < 2; w++) for (let i = 0; i < reps; i++) fn();
  const runs = [];
  for (let p = 0; p < 7; p++) { const t = now(); for (let i = 0; i < reps; i++) fn(); runs.push(now() - t); }
  runs.sort((a, b) => a - b);
  return { median: runs[3] / reps, sampleMs: runs[3], reps };
};

export const COMPUTED_ROWS = [
  'c1 create + first watched read (200)',
  'c2 write re-evaluates a watched computed, 1 reader',
  'c3 unwatched pull, cache hit',
  'c4 unwatched pull, miss (a write between)',
  'c5 20-deep chain settles on a write',
  'c6 a run making 10 computeds per run (create/release churn)',
];

/** `only`: the row NUMBERS to time (`'3'` = c3), for a narrow pick; every row when absent (setups still run). */
export const runComputed = (core, now, reps, only) => {
  const { createStore, effect, flush, computed } = core;
  const at = (i) => reps?.[COMPUTED_ROWS[i]];
  const want = (i) => !only || only.includes(String(i + 1));
  const out = {};
  const s = createStore({ a: 1, b: 2, n: 0, other: 0 });
  if (want(0)) out[COMPUTED_ROWS[0]] = measure(now, () => {
    for (let i = 0; i < 200; i++) {
      const c = computed(() => s.a + s.b);
      const e = effect(() => { sink.v += c.value; }, { owner: {}, timing: 'sync' });
      e.run();
      e.stop();
    }
  }, at(0));
  {
    const w = createStore({ n: 0 });
    const c = computed(() => w.n * 2);
    const e = effect(() => { sink.v += c.value; }, { owner: {} });
    e.run();
    if (want(1)) out[COMPUTED_ROWS[1]] = measure(now, () => { for (let i = 0; i < 2000; i++) { w.n++; flush(); } }, at(1));
    e.stop();
  }
  {
    const c = computed(() => s.a + s.b);
    if (want(2)) out[COMPUTED_ROWS[2]] = measure(now, () => { for (let i = 0; i < 10000; i++) sink.v += c.value; }, at(2));
    if (want(3)) out[COMPUTED_ROWS[3]] = measure(now, () => { for (let i = 0; i < 2000; i++) { s.other++; sink.v += c.value; } }, at(3));
  }
  {
    const w = createStore({ n: 0 });
    let c = computed(() => w.n);
    for (let i = 1; i < 20; i++) { const prev = c; c = computed(() => prev.value + 1); }
    const last = c;
    const e = effect(() => { sink.v += last.value; }, { owner: {} });
    e.run();
    if (want(4)) out[COMPUTED_ROWS[4]] = measure(now, () => { for (let i = 0; i < 500; i++) { w.n++; flush(); } }, at(4));
    e.stop();
  }
  {
    const e = effect(() => {
      for (let i = 0; i < 10; i++) { const c = computed(() => s.a + i); sink.v += c.value; }
    }, { owner: {} });
    e.run();
    if (want(5)) out[COMPUTED_ROWS[5]] = measure(now, () => { for (let r = 0; r < 200; r++) e.run(); }, at(5));
    e.stop();
  }
  return { rows: out, sink: sink.v };
};

/**
 * **Retained heap per WATCHED computed** (Node, `--expose-gc`): 10,000 computeds over one key, each read by its own
 * sync effect, all kept; heap after forced gc minus before, per computed (its record, its evaluating hook, its handle,
 * its cell, the reader's link). The CONTROL: the same loop's effects alone, without a computed between, reported beside.
 */
export const computedMemory = (core) => {
  const { createStore, effect, computed } = core;
  const s = createStore({ a: 1 });
  const K = 10000;
  const once = (withComputed) => {
    globalThis.gc();
    const before = process.memoryUsage().heapUsed;
    const kept = [];
    for (let i = 0; i < K; i++) {
      const c = withComputed ? computed(() => s.a + 1) : undefined;
      const e = effect(() => { void (c ? c.value : s.a); }, { owner: {}, timing: 'sync' });
      e.run();
      kept.push(e, c);
    }
    globalThis.gc();
    const per = (process.memoryUsage().heapUsed - before) / K;
    void kept.length;
    return per;
  };
  const effects = once(false);
  const total = once(true);
  return { 'CONTROL: per effect alone (bytes)': effects, 'per effect + watched computed (bytes)': total, 'the computed (difference)': total - effects };
};
