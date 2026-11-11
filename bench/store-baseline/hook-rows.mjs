/**
 * **The hook-record race's rows** (2026-10-26): the same workloads over core's public `effect` for every record
 * variant (class / method-field object / data-only + kind table). Reps come from the caller (calibrated once on (a)) or
 * are calibrated warm with a 2× margin; a sample is ≥ 50 ms.
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

export const HOOK_ROWS = ['creation: 1000 effects, created + first run', 'first run (re-run of one effect)', 'update: 1 write wakes 1 hook', 'fan-out: 1 write wakes 1000 hooks', 'teardown: 1000 stop()s', 'store row 2: first run over 100 keys', 'store row 3: re-run over 100 keys'];

export const runHooks = (core, now, reps) => {
  const { createStore, effect, flush } = core;
  const at = (i) => reps?.[HOOK_ROWS[i]];
  const out = {};
  const s = createStore({ a: 1, b: 2, c: 3 });
  out[HOOK_ROWS[0]] = measure(now, () => {
    const es = [];
    for (let i = 0; i < 1000; i++) { const e = effect(() => { sink.v += s.a + s.b + s.c; }, { owner: {} }); e.run(); es.push(e); }
    for (let i = 0; i < 1000; i++) es[i].stop();
  }, at(0));
  {
    const e = effect(() => { sink.v += s.a + s.b + s.c; }, { owner: {} });
    e.run();
    out[HOOK_ROWS[1]] = measure(now, () => { for (let i = 0; i < 1000; i++) e.run(); }, at(1));
    e.stop();
  }
  {
    const w = createStore({ n: 0 });
    const e = effect(() => { sink.v += w.n; }, { owner: {} });
    e.run();
    out[HOOK_ROWS[2]] = measure(now, () => { for (let i = 0; i < 2000; i++) { w.n++; flush(); } }, at(2));
    e.stop();
  }
  {
    const w = createStore({ n: 0 });
    const es = Array.from({ length: 1000 }, () => { const e = effect(() => { sink.v += w.n; }, { owner: {} }); e.run(); return e; });
    out[HOOK_ROWS[3]] = measure(now, () => { for (let i = 0; i < 20; i++) { w.n++; flush(); } }, at(3));
    for (const e of es) e.stop();
  }
  out[HOOK_ROWS[4]] = measure(now, () => {
    const es = [];
    for (let i = 0; i < 1000; i++) { const e = effect(() => { sink.v += s.a; }, { owner: {} }); e.run(); es.push(e); }
    for (let i = 0; i < 1000; i++) es[i].stop();
  }, at(4));
  const keys = Array.from({ length: 100 }, (_, i) => `k${i}`);
  const wide = createStore(Object.fromEntries(keys.map((k, i) => [k, i])));
  out[HOOK_ROWS[5]] = measure(now, () => {
    for (let r = 0; r < 200; r++) { const e = effect(() => { for (let i = 0; i < 100; i++) sink.v += wide[keys[i]]; }, { owner: {} }); e.run(); e.stop(); }
  }, at(5));
  {
    const e = effect(() => { for (let i = 0; i < 100; i++) sink.v += wide[keys[i]]; }, { owner: {} });
    e.run();
    out[HOOK_ROWS[6]] = measure(now, () => { for (let r = 0; r < 200; r++) e.run(); }, at(6));
    e.stop();
  }
  return { rows: out, sink: sink.v };
};

/**
 * **Retained heap per hook** (report the record AND the handle): 10,000 effects × 3 keys, heap after forced gc
 * minus before, per effect — once with the returned handles DROPPED (only the owners kept, which keep the records via
 * their hook lists) and once with them KEPT.
 */
export const hookMemory = (core) => {
  const { createStore, effect } = core;
  const s = createStore({ a: 1, b: 2, c: 3 });
  const K = 10000;
  const measureOnce = (keepHandles) => {
    globalThis.gc();
    const before = process.memoryUsage().heapUsed;
    const owners = [];
    const handles = [];
    for (let i = 0; i < K; i++) {
      const o = {};
      const e = effect(() => { void (s.a + s.b + s.c); }, { owner: o });
      e.run();
      owners.push(o);
      if (keepHandles) handles.push(e);
    }
    globalThis.gc();
    const per = (process.memoryUsage().heapUsed - before) / K;
    void owners.length;
    void handles.length;
    return per;
  };
  return { 'retained per hook, handles DROPPED (bytes)': measureOnce(false), 'retained per hook, handles KEPT (bytes)': measureOnce(true) };
};
