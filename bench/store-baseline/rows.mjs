/**
 * **The store baseline's rows** (the additive rebuild, step (b), 2026-10-26): ONE set of workloads over core's public API
 * (`createStore`, `effect`, `flush`), run by every driver (Node, a browser page) against every arm (S, the frozen
 * reference, its byte A/A, a planted copy). Split rows so a win on one path cannot hide a loss on another. Each row
 * returns a steady-state median and a cold total of its first passes.
 */
const sink = { v: 0 };
/**
 * **A sample must be tens of milliseconds long** (CLAUDE.md: Firefox and WebKit coarsen `performance.now()` toward 1 ms,
 * so a sample of one ~3 ms run measures the clock's ticks — the first page run of this bench reported whole milliseconds
 * and was VOID). So each sample repeats the row's body `reps` times, `reps` doubled until ONE sample lasts at least
 * `MIN_SAMPLE` ms, and every number is reported PER REPETITION (`median`, `cold`) together with the sample's length
 * (`sampleMs`), which a reader checks against the clock (a row under `VOID_BELOW` ms is void).
 * The cold total is the first `cold` repetitions, before any calibration or warm-up.
 */
const SKIPPED = { skipped: true };
export const MIN_SAMPLE = 50;
export const VOID_BELOW = 20;
const measure = (now, fn, { warm = 2, passes = 7, cold = 3, fixed, skip } = {}) => {
  /** A row this run does not time (`only`): its setup still ran, its loop does not. */
  if (skip) return SKIPPED;
  let coldTotal = 0;
  for (let i = 0; i < cold; i++) {
    const t = now();
    fn();
    coldTotal += now() - t;
  }
  /** FIXED reps: calibrated ONCE per row on the reference and used by every arm, so a slower arm is not given
   *  fewer repetitions — less warm-up and tier-up inside its sample — than a faster one. Calibrated here only when none
   *  is given (the calibration run itself). */
  let reps = fixed ?? 1;
  if (fixed === undefined) {
    /** Calibrated WARM, with a 2× margin: calibrated cold, a row whose first run alone passed 50 ms got 1 rep and a
     *  5 ms warm sample (the first fixed-reps run's VOID rows, 2026-10-26). */
    for (let i = 0; i < 3; i++) fn();
    for (;;) {
      const t = now();
      for (let i = 0; i < reps; i++) fn();
      if (now() - t >= MIN_SAMPLE || reps >= 1 << 20) break;
      reps *= 2;
    }
    reps *= 2;
  }
  /** `total`: per rep over warm + passes, every collection included; `passes`: each timed pass in order. A short window's median can skip a collection
   *  that a total cannot (CLAUDE.md), and one row read 62 or 127 us by the median depending on its reps alone (2026-10-31). */
  const start = now();
  for (let w = 0; w < warm; w++) for (let i = 0; i < reps; i++) fn();
  const runs = [];
  for (let p = 0; p < passes; p++) {
    const t = now();
    for (let i = 0; i < reps; i++) fn();
    runs.push(now() - t);
  }
  const total = (now() - start) / ((warm + passes) * reps);
  const inOrder = [...runs];
  runs.sort((a, b) => a - b);
  const sampleMs = runs[runs.length >> 1];
  return { median: sampleMs / reps, cold: coldTotal / cold, sampleMs, reps, total, passes: inOrder };
};

export const ROWS = [
  '1 record read, untracked',
  '2 tracked FIRST run over 100 keys',
  '3 tracked RE-run over the same 100 keys',
  '4 nested read, 2 hops',
  '5 array index read, tracked',
  '6 length read, tracked',
  '7 push + splice on a read array',
  '8a write, no reader',
  '8b write, 1 reader',
  '8c write, 1000 readers',
  '9 array index write, 1 reader',
  '10 reverse-order wakes (1000 effects)',
  '11 createStore 10 keys + first nested read',
  '12 teardown: 1000 effects over shared keys, created then stopped',
  '13 first write to a fresh 10k-item array, then 9 more',
  '14 first write to a fresh 10-key record, then 9 more',
  '15 first write to a fresh 10k-key record, then 9 more',
  '16 writes that ADD keys: 10 new keys to a fresh record',
  '17 splice mid-list, one effect per row reading its own index',
  '18 divergent re-run: each run reads a different half of 100 keys',
  '19 first read of 1000 fresh list items',
  'p7 row 7 on a plain array, no store',
  'p8 row 8a on a plain object, no store',
  'w bare WeakMap: 400 young keys + a read, no store',
  'c1 first read of 1000 class-instance items',
  'c2 reading through 1000 class instances, each with a read-only object field',
  'a1 1000 inherited-method calls on a store instance, in a tracked run',
  'a2 map over a 100-item store array, in a tracked run',
  'a3 1000 effects that each push once, created, run and stopped',
  'a4 write a fresh 10-key plain object into a key, 1 reader',
  'a5 write a fresh object holding a store into a key, 1 reader',
  'a6 first nested read in 1000 fresh rows (row.user.name)',
  'a7 first nested read in 1000 fresh class instances (item.user.name)',
];

/** `core` is the bundle's module namespace; `now` the clock. Every row reads its results into `sink`, so none is dead code. */
/** `only`: the row LABELS to time (`'12'` = the teardown row, `'8c'`), one row per page: a row inherits the rows timed before
 *  it in a page (BROWSER-LEDGER, 2026-10-31). Every row when absent. */
export const run = (core, now, reps, only) => {
  /** The fixed reps for row `i`, when this run was given them; `skip` when `only` leaves it out. */
  const at = (i) => ({ ...(reps ? { fixed: reps[ROWS[i]] } : {}), ...(only && !only.includes(ROWS[i].split(' ')[0]) ? { skip: true } : {}) });
  const { createStore, effect, flush } = core;
  /** `flip`, named only: one frozen store first, so `anyFixed` is on for the whole page, as an app with one such object is. */
  if (only?.includes('flip')) sink.v += createStore(Object.freeze({ a: 1 })).a;
  const owner = () => ({});
  const started = (fn, o = owner(), options) => {
    const e = effect(fn, { owner: o, ...options });
    e.run();
    return e;
  };
  const out = {};
  const N = 100000;

  const rec = createStore({ a: 1, b: 2, nested: { deep: { value: 1 } }, list: [1, 2, 3, 4, 5, 6, 7, 8] });
  out[ROWS[0]] = measure(now, () => { for (let i = 0; i < N; i++) sink.v += rec.a; }, at(0));

  const keys = Array.from({ length: 100 }, (_, i) => `k${i}`);
  const wide = createStore(Object.fromEntries(keys.map((k, i) => [k, i])));
  out[ROWS[1]] = measure(now, () => {
    for (let r = 0; r < 200; r++) {
      const e = started(() => { for (let i = 0; i < 100; i++) sink.v += wide[keys[i]]; });
      e.stop();
    }
  }, at(1));
  {
    const e = started(() => { for (let i = 0; i < 100; i++) sink.v += wide[keys[i]]; });
    out[ROWS[2]] = measure(now, () => { for (let r = 0; r < 200; r++) e.run(); }, at(2));
    e.stop();
  }
  {
    let row;
    const e = started(() => { row = measure(now, () => { for (let i = 0; i < N; i++) sink.v += rec.nested.deep.value; }, { passes: 5, ...at(3) }); });
    out[ROWS[3]] = row;
    e.stop();
  }
  {
    let row;
    const e = started(() => { row = measure(now, () => { for (let i = 0; i < N; i++) sink.v += rec.list[i & 7]; }, { passes: 5, ...at(4) }); });
    out[ROWS[4]] = row;
    e.stop();
  }
  {
    let row;
    const e = started(() => { row = measure(now, () => { for (let i = 0; i < N; i++) sink.v += rec.list.length; }, { passes: 5, ...at(5) }); });
    out[ROWS[5]] = row;
    e.stop();
  }
  {
    const arr = createStore({ items: [] });
    const e = started(() => { sink.v += arr.items.length; });
    out[ROWS[6]] = measure(now, () => {
      for (let i = 0; i < 2000; i++) arr.items.push(i);
      arr.items.splice(0, 2000);
      flush();
    }, at(6));
    e.stop();
  }
  {
    const w = createStore({ n: 0 });
    out[ROWS[7]] = measure(now, () => { for (let i = 0; i < 20000; i++) w.n = i; }, at(7));
  }
  {
    const w = createStore({ n: 0 });
    const e = started(() => { sink.v += w.n; });
    out[ROWS[8]] = measure(now, () => { for (let i = 0; i < 20000; i++) w.n = i; flush(); }, at(8));
    e.stop();
  }
  {
    const w = createStore({ n: 0 });
    const es = Array.from({ length: 1000 }, () => started(() => { sink.v += w.n; }));
    out[ROWS[9]] = measure(now, () => { for (let i = 0; i < 20; i++) { w.n++; flush(); } }, at(9));
    for (const e of es) e.stop();
  }
  {
    const w = createStore({ list: [0, 0, 0, 0] });
    const e = started(() => { sink.v += w.list[2]; });
    out[ROWS[10]] = measure(now, () => { for (let i = 0; i < 20000; i++) w.list[2] = i; flush(); }, at(10));
    e.stop();
  }
  {
    /** 1000 effects created in order, each reading its OWN key; one write per key, in REVERSE, then one flush. */
    const w = createStore(Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`k${i}`, 0])));
    const es = Array.from({ length: 1000 }, (_, i) => started(() => { sink.v += w[`k${i}`]; }));
    out[ROWS[11]] = measure(now, () => { for (let i = 999; i >= 0; i--) w[`k${i}`]++; flush(); }, at(11));
    for (const e of es) e.stop();
  }
  /** PROBE rows, run only when named in `only`, so no other page changes: what do rows 7 and 8a leave behind with no store involved, and what
   *  does a WeakMap alone do? (2026-10-31: each write row doubles row 11 on the rebuild; the read rows do not.) */
  /** A DOSE of store writes before row 11, untimed: `d1`, `d100`, `d20000`. */
  for (const d of [1, 100, 20000]) if (only?.includes(`d${d}`)) {
    const w = createStore({ n: 0 });
    for (let i = 0; i < d; i++) w.n = i + 1;
  }
  /** PROBE row, run only when named: what a store made per class instance pays. Named fields, none read-only, so a scan of own keys finds nothing and costs what it costs. */
  if (only?.includes('c1')) {
    class Item { constructor(i) { this.id = i; this.label = 'x'; this.a = 1; this.b = 2; } }
    out[ROWS[24]] = measure(now, () => {
      const list = createStore({ rows: Array.from({ length: 1000 }, (_, i) => new Item(i)) }).rows;
      for (let i = 0; i < 1000; i++) sink.v += list[i].id;
    }, at(24));
  }
  /** PROBE, named only: a marked instance fetches a descriptor per object-valued read. */
  if (only?.includes('c2')) {
    class Locked { constructor(i) { this.id = i; Object.defineProperty(this, 'meta', { value: { x: 1 } }); } }
    const list = createStore({ rows: Array.from({ length: 1000 }, (_, i) => new Locked(i)) }).rows;
    out[ROWS[25]] = measure(now, () => { for (let i = 0; i < 1000; i++) { try { sink.v += list[i].meta.x; } catch { sink.v -= 1; } } }, at(25));
  }
  /**
   * PERMANENT rows (Brian, 2026-11-10; run by default, after every other row, so no earlier row changes; probe rows
   * until then): what tracking a function-valued read costs, on the two paths an app meets
   * (a class method, an array's own non-mutator method). Each carries `wakes`, a COUNTED control on a separate store: the
   * read then a swap of the function, which wakes 1 where function values are tracked and 0 where they are not. A row
   * whose count is not the arm's expected one measured something else, and is VOID.
   */
  const counted = (data, read, swap) => {
    const store = createStore(data);
    let n = 0;
    const e = started(() => { n++; read(store); });
    swap(store);
    flush();
    e.stop();
    return n - 1;
  };
  if ((!only || only.includes('a1'))) {
    class Item { constructor(i) { this.id = i; } value() { return this.id; } }
    const item = createStore({ item: new Item(3) }).item;
    let row;
    const e = started(() => { row = measure(now, () => { for (let i = 0; i < 1000; i++) sink.v += item.value(); }, { passes: 5, ...at(26) }); });
    e.stop();
    out[ROWS[26]] = { ...row, wakes: counted(new Item(1), (s) => s.value(), (s) => { s.value = () => 2; }) };
  }
  if ((!only || only.includes('a2'))) {
    const list = createStore({ rows: Array.from({ length: 100 }, (_, i) => ({ v: i })) }).rows;
    let row;
    const e = started(() => { row = measure(now, () => { for (let r = 0; r < 10; r++) sink.v += list.map((x) => x.v).length; }, { passes: 5, ...at(27) }); });
    e.stop();
    out[ROWS[27]] = { ...row, wakes: counted({ rows: [1] }, (s) => s.rows.map((x) => x), (s) => { s.rows.map = () => []; }) };
  }
  /** a3: what tracking an array mutator's KEY costs where it lands, every effect that calls it subscribing to `push`
   *  (the form NOT taken: a store leaves mutator reads untracked). `wakes`: how many of 10 pushing effects a replaced
   *  `push` wakes (10 where the key is tracked, 0 where not). */
  if ((!only || only.includes('a3'))) {
    out[ROWS[28]] = measure(now, () => {
      const list = createStore({ rows: [] }).rows;
      const made = [];
      for (let i = 0; i < 1000; i++) made.push(started(() => { list.push(i); }));
      for (let i = 0; i < 1000; i++) made[i].stop();
    }, at(28));
    const list = createStore({ rows: [] }).rows;
    let n = 0;
    const made = [];
    for (let i = 0; i < 10; i++) made.push(started(() => { n++; list.push(i); }));
    const first = n;
    list.push = () => 0;
    flush();
    for (const e of made) e.stop();
    out[ROWS[28]] = { ...out[ROWS[28]], wakes: n - first };
  }
  /** a4 / a5: what a WRITE of a fresh record pays: a4 a record of primitives, a5 one holding a store child. On the base
   *  since D5 (2026-11-10) both are stored as given, never scanned (`snapshot` copies out). `raw`: 1 when the CALLER's
   *  data, read after the write, holds the child's RAW object (a copy ran), 0 when it holds the proxy (counted on a
   *  separate store: the row's evidence of which path ran). */
  const rawCheck = () => {
    const child = createStore({ v: 1 });
    const data = { k: null };
    const store = createStore(data);
    store.k = { child };
    return data.k.child === child ? 0 : 1;
  };
  if ((!only || only.includes('a4'))) {
    const store = createStore({ k: null });
    const e = started(() => { sink.v += store.k ? 1 : 0; });
    out[ROWS[29]] = { ...measure(now, () => { for (let i = 0; i < 1000; i++) store.k = { a: i, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: 7, j: 8, l: 9 }; flush(); }, at(29)), raw: rawCheck() };
    e.stop();
  }
  if ((!only || only.includes('a5'))) {
    const store = createStore({ k: null });
    const inner = createStore({ v: 1 });
    const e = started(() => { sink.v += store.k ? 1 : 0; });
    out[ROWS[30]] = { ...measure(now, () => { for (let i = 0; i < 1000; i++) store.k = { child: inner, a: i, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: 7, j: 8 }; flush(); }, at(30)), raw: rawCheck() };
    e.stop();
  }
  /** a6: the first read of an object nested in a PLAIN-object parent, once per row: where a read-only check on a cache
   *  miss under a plain parent would land. */
  if ((!only || only.includes('a6'))) {
    out[ROWS[31]] = measure(now, () => {
      const list = createStore({ rows: Array.from({ length: 1000 }, (_, i) => ({ id: i, user: { name: 'x' } })) }).rows;
      for (let i = 0; i < 1000; i++) sink.v += list[i].user.name.length;
    }, at(31));
  }
  /** a7: the same first nested read, its parent a CLASS instance: where a class-only read-only check lands. */
  if ((!only || only.includes('a7'))) {
    class Row { constructor(i) { this.id = i; this.user = { name: 'x' }; } }
    out[ROWS[32]] = measure(now, () => {
      const list = createStore({ rows: Array.from({ length: 1000 }, (_, i) => new Row(i)) }).rows;
      for (let i = 0; i < 1000; i++) sink.v += list[i].user.name.length;
    }, at(32));
  }
  if (only?.includes('p7')) {
    const items = [];
    out[ROWS[21]] = measure(now, () => {
      for (let i = 0; i < 2000; i++) items.push(i);
      items.splice(0, 2000);
    }, at(21));
  }
  if (only?.includes('p8')) {
    const w = { n: 0 };
    out[ROWS[22]] = measure(now, () => { for (let i = 0; i < 20000; i++) { w.n = i; sink.v += w.n & 1; } }, at(22));
  }
  if (only?.includes('w')) {
    const map = new WeakMap();
    out[ROWS[23]] = measure(now, () => {
      for (let r = 0; r < 200; r++) {
        const s = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10, n: { x: 1 } };
        map.set(s, {});
        map.set(s.n, {});
        sink.v += map.has(s.n) ? s.n.x : 0;
      }
    }, at(23));
  }
  out[ROWS[12]] = measure(now, () => {
    for (let r = 0; r < 200; r++) {
      const s = createStore({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10, n: { x: 1 } });
      sink.v += s.n.x;
    }
  }, at(12));
  {
    const shared = createStore({ a: 1, b: 2, c: 3 });
    out[ROWS[13]] = measure(now, () => {
      const es = [];
      for (let i = 0; i < 1000; i++) es.push(started(() => { sink.v += shared.a + shared.b + shared.c; }));
      for (let i = 0; i < 1000; i++) es[i].stop();
    }, at(13));
  }
  /** A store's FIRST write is where a write path that classifies its object pays (a 10k-item array's every index), and
   *  later writes are where it saves. The array is made outside the timed body's store, raw and unread. Never a `-0`
   *  (`-i` from 0): one `-0` re-stores an all-integer array as doubles, a copy of all 10k, and a store comparing with
   *  `===` skips that write entirely, so the row measured the conversion, not the store (BROWSER-LEDGER, 2026-10-28). */
  {
    const big = Array.from({ length: 10000 }, (_, i) => i);
    out[ROWS[14]] = measure(now, () => {
      const s = createStore(big.slice());
      for (let i = 0; i < 10; i++) s[i] = -i - 1;
      sink.v += s.length;
    }, at(14));
  }
  {
    const dict = Object.fromEntries(Array.from({ length: 10000 }, (_, i) => [`id${i}`, i]));
    out[ROWS[16]] = measure(now, () => {
      const s = createStore({ ...dict });
      for (let i = 0; i < 10; i++) s[`id${i}`] = -i;
      sink.v += s.id0;
    }, at(16));
  }
  out[ROWS[15]] = measure(now, () => {
    for (let r = 0; r < 200; r++) {
      const s = createStore({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10 });
      for (let i = 0; i < 10; i++) s.a = i;
      sink.v += s.a;
    }
  }, at(15));
  out[ROWS[17]] = measure(now, () => {
    for (let r = 0; r < 200; r++) {
      const s = createStore({ a: 1 });
      for (let i = 0; i < 10; i++) s[`k${i}`] = i;
      sink.v += s.a;
    }
  }, at(17));
  /** What a splice's precise start serves: rows BEFORE the splice keep their values, so a store that wakes from 0 re-runs
   *  half the list for nothing (measured: waking from 0 cost the rebuilt core 1.45× the current build, from its start 0.72). */
  {
    const st = createStore({ list: Array.from({ length: 1001 }, (_, i) => i) });
    const es = Array.from({ length: 1000 }, (_, i) => started(() => { sink.v += st.list[i]; }));
    out[ROWS[18]] = measure(now, () => { st.list.splice(500, 1); st.list.push(1); flush(); }, at(18));
    for (const e of es) e.stop();
  }
  /** A re-run whose keys differ every time: the reuse cursor diverges and relinks, and each dropped key's cell empties (and,
   *  re-read later, is linked again). Pre-registered against brick #1 (2026-10-28). */
  {
    const wide = createStore(Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, i])));
    const keys = Object.keys(wide);
    let shift = 0;
    const e = started(() => { for (let i = 0; i < 50; i++) sink.v += wide[keys[(i * 2 + shift) % 100]]; });
    out[ROWS[19]] = measure(now, () => { for (let r = 0; r < 200; r++) { shift = (shift + 1) % 100; e.run(); } }, at(19));
    e.stop();
  }
  /** The list-loading path: one store per ITEM, made on its first read. Row 13 is one store over one array of numbers and
   *  never reaches this. Last in the page, so no earlier row's timing moves (BROWSER-LEDGER, 2026-10-31). */
  out[ROWS[20]] = measure(now, () => {
    const list = createStore({ rows: Array.from({ length: 1000 }, (_, i) => ({ id: i, label: 'x' })) }).rows;
    for (let i = 0; i < 1000; i++) sink.v += list[i].id;
  }, at(20));
  for (const k of Object.keys(out)) if (out[k] === SKIPPED) delete out[k];
  return { rows: out, sink: sink.v };
};

/**
 * **Allocation per op**: rows 1, 4 and 5 for 1e6 iterations with forced gc before and after — heap growth per
 * op, expected ≈ 0 for a store that allocates nothing per read. CONTROL: a loop allocating one object per iteration
 * (kept alive in an array) must read well above 0, or the instrument measures nothing. Node only (`--expose-gc`).
 */
export const allocation = (core) => {
  const { createStore, effect } = core;
  const rec = createStore({ a: 1, nested: { deep: { value: 1 } }, list: [1, 2, 3, 4, 5, 6, 7, 8] });
  const M = 1000000;
  const per = (fn) => {
    fn(1000);
    globalThis.gc();
    const before = process.memoryUsage().heapUsed;
    const kept = fn(M);
    const after = process.memoryUsage().heapUsed;
    void kept;
    globalThis.gc();
    return (after - before) / M;
  };
  const out = {};
  out['CONTROL: one object per op, kept'] = per((n) => { const a = []; for (let i = 0; i < n; i++) a.push({ i }); return a; });
  out['1 record read, untracked'] = per((n) => { let s = 0; for (let i = 0; i < n; i++) s += rec.a; return s; });
  let tracked = {};
  const e = effect(() => {
    tracked['4 nested read, 2 hops, tracked'] = per((n) => { let s = 0; for (let i = 0; i < n; i++) s += rec.nested.deep.value; return s; });
    tracked['5 array index read, tracked'] = per((n) => { let s = 0; for (let i = 0; i < n; i++) s += rec.list[i & 7]; return s; });
  }, { owner: {} });
  e.run();
  e.stop();
  return { ...out, ...tracked };
};

/**
 * **Retained heap per hook**: 10,000 effects each tracking 3 keys of one store, kept alive; heap after gc,
 * minus the heap before, per effect. The owners and effects are held in an array for the measurement and dropped after.
 */
export const memoryPerHook = (core) => {
  const { createStore, effect } = core;
  const s = createStore({ a: 1, b: 2, c: 3 });
  const K = 10000;
  globalThis.gc();
  const before = process.memoryUsage().heapUsed;
  const held = [];
  for (let i = 0; i < K; i++) {
    const e = effect(() => { void (s.a + s.b + s.c); }, { owner: {} });
    e.run();
    held.push(e);
  }
  globalThis.gc();
  const after = process.memoryUsage().heapUsed;
  const perHook = (after - before) / K;
  for (const e of held) e.stop();
  return { 'retained heap per effect (3 keys), bytes': perHook, held: held.length };
};
