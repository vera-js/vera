/**
 * Runner for the DOM benchmark.
 *
 * Getting this wrong is easy and quiet, so the design is deliberately defensive:
 *
 * - **Every framework declares when its DOM work is done.** Each operation returns a promise that
 *   resolves once that framework has written the DOM; only then does the runner wait for paint.
 *   Without this the comparison silently favored whichever library exposed a completion promise —
 *   Lit's `updateComplete` resolved after its microtask had already mutated the DOM, leaving it the
 *   rest of the frame to lay out, while a framework that schedules on an animation frame had its
 *   work land inside the measurement window instead.
 *
 * - **Order is rotated.** The framework that runs first for an operation changes each time, so
 *   position in the sequence — cold caches, garbage left by the previous run — cannot consistently
 *   favor or penalize one of them.
 *
 * - **The minimum is the headline, not the median.** Noise here is one-sided: a garbage collection
 *   or a scheduling hiccup can only ever make a run slower, never faster, so the fastest run is the
 *   cleanest estimate of what the framework actually costs. This is not a theoretical preference —
 *   across three runs of an earlier build the *median* handed the 10 000-row win to a different
 *   framework each time (Vue, then Solid, then VeraJS) at an almost identical ~392 ms, while every
 *   framework's *minimum* stayed stable within 1–2%. The median was measuring the garbage collector.
 *
 * - **The median is still shown**, underneath. A framework whose median sits far above its minimum
 *   is allocating enough to provoke collection, and that is real information the minimum hides — so
 *   neither number is dropped.
 */
import { IMPLEMENTATIONS as ALL, resetIds } from './impls.js';

/** For probes that drive an implementation directly (the markup-parity check). */
window.__BENCH__ = { IMPLEMENTATIONS: ALL, resetIds };

/** `?only=VeraJS own,Lit` runs those implementations alone — a race compares builds, not the whole table. */
const only = new URLSearchParams(location.search).get('only')?.split(',');
const IMPLEMENTATIONS = only ? ALL.filter((impl) => only.includes(impl.name)) : ALL;

const REPEATS = 7;
const WARMUP = 2;

/**
 * **`?batch=N` times the small ops N to a sample** (2026-10-18). One select or swap takes a few ms, and Firefox and
 * WebKit report whole milliseconds, so a single-op sample is mostly rounding: Solid raced against itself swung up to
 * 267%. Under `?batch`, a sample of select / swap / remove is the op run back to back in ONE task until the sample
 * reaches its time box (50 ms), each run awaited (every framework has written the DOM before the next run starts;
 * `&verify=1` proves it), and is reported per op; the paint that follows is outside the sample. **An op whose per-run
 * work depends on the run index gets a FIXED N, never a time box** (2026-10-18), or a faster framework's later
 * runs face different work: update10 runs 200 (its labels grow each run), remove 500 (the table shrinks each run, and
 * a boxed faster framework would remove against a smaller one). A fixed N of 100 couldn't resolve compiled Solid's 10 µs select on a whole-ms clock (one tick). Batched,
 * style and layout happen once for the net change, so the number is script + DOM writes per op; `&layout=1` forces
 * layout after every run (an `offsetHeight` read), the per-interaction cost a real click pays. The race reports both
 * as separate variants. `noop` (an op that does nothing) is the floor: each batched op is also reported as
 * `<op>:net`, its per-op time minus noop's. Off by default, so older records stay comparable. update10 appends to
 * labels each run, so the 20th run writes slightly longer strings than the 1st, the same for every framework.
 */
const params = new URLSearchParams(location.search);
/** `?batch[=ms]`: the time box of one batched sample (50 ms), about 2% of resolution on a whole-millisecond clock. */
const BATCH = params.has('batch') ? Number(params.get('batch')) || 50 : 0;
const LAYOUT = params.has('layout');
/** `&plant=N`: the positive control's planted work, in loop iterations (see the `-dom` rows). */
const PLANT = Number(params.get('plant')) || 0;
/**
 * **`&plantpct=P`: the per-row positive control** (2026-11-08, the 5–10-minute test standard): every timed run of EVERY row
 * carries counted work equal to P% of that row's own run time on this page (measured on its warm-up runs, which carry
 * none), so an arm with it must read P% slower on every row the race reads, or that row cannot see a loss of that size.
 * Iterations from this page's measured cost per iteration (never a timed wait: Firefox and WebKit coarsen the clock).
 */
const PLANTPCT = Number(params.get('plantpct')) || 0;
const NS_PER_ITER = (() => {
  if (!PLANTPCT) return 0;
  let acc = 0, n = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < 60) { for (let i = 0; i < 100000; i++) acc = (acc * 31 + i) | 0; n += 100000; }
  window.__PLANT_SINK__ = acc;
  return ((performance.now() - t0) * 1e6) / n;
})();
const spin = (ms) => {
  let acc = window.__PLANT_SINK__ | 0;
  const n = Math.round((ms * 1e6) / NS_PER_ITER);
  for (let i = 0; i < n; i++) acc = (acc * 31 + i) | 0;
  window.__PLANT_SINK__ = acc;
};
/** `&minms=M`: a re-batched sample holds at least M ms of the op's own work (its run count grows to reach it). */
const MINMS = Number(params.get('minms')) || 0;
/** The re-batch growth's ceiling: a row whose single run is tiny would otherwise ask for hundreds of set-ups (the stall
 *  of 2026-11-08). A sample still short at the cap is printed as such by its row's own time. */
const MAXREBATCH = 32;
/**
 * **`&counts=op:N,…`: every row's runs per sample, the SAME for every arm** (2026-11-08). Sizing a count from an arm's own
 * speed gives a faster arm a larger N, which amortizes the sample's fixed overhead differently and leans the comparison
 * toward it. So the race calibrates once per engine on its base arm (`&calibrate`: warm-ups only, the counts reported in
 * `__COUNTS__`) and passes the same counts to every page. Without `counts`, the old per-page sizing and time boxes hold.
 */
const COUNTS = Object.fromEntries((params.get('counts') ?? '').split(',').filter(Boolean).map((pair) => [pair.split(':')[0], Number(pair.split(':')[1])]));
const CALIBRATE = params.has('calibrate');
/**
 * **`&pagems=L`: a page's wall-time limit** (default 15 s): past it the page stops and reports `__PAGE_ERROR__`, and the
 * race fails loudly rather than waiting. Every race is bounded by construction: pages × L, projected before launch.
 */
const PAGE_MS = Number(params.get('pagems')) || 15000;
/** Which harness sources this bundle was built from (`harness-sha.mjs`): the race checks it against the files on disk. */
/* global __HARNESS__ -- defined by build.mjs at bundle time */
window.__HARNESS__ = typeof __HARNESS__ === 'string' ? __HARNESS__ : 'unstamped';
const pageStart = performance.now();
/**
 * The clock this page times with: whether it is cross-origin isolated (`race.mjs --coi`) and the smallest nonzero step
 * `performance.now()` takes here, sampled for ~20 ms (an engine coarsens it, toward 1 ms on Firefox and WebKit unless
 * isolated). The race prints both per engine.
 */
window.__TIMER__ = (() => {
  let tick = Infinity;
  const t0 = performance.now();
  for (let last = t0, now = t0; now - t0 < 20; now = performance.now()) {
    if (now > last) tick = Math.min(tick, now - last);
    last = now;
  }
  return { isolated: globalThis.crossOriginIsolated === true, tickUs: Math.round(tick * 1000 * 100) / 100 };
})();
/**
 * The plant's ACTUAL cost on THIS engine: N was calibrated on V8, so SpiderMonkey or JavaScriptCore may make
 * 0.5–2× of it. Timed once, as 200 × N in one block (~20 ms: tens of times a coarsened clock's tick), and reported with
 * the results, so the control's measured Δ can be compared with its real size.
 */
if (PLANT) {
  let acc = 0;
  const t0 = performance.now();
  for (let r = 0; r < 200; r++) for (let i = 0; i < PLANT; i++) acc = (acc * 31 + i) | 0;
  window.__PLANT_US__ = ((performance.now() - t0) / 200) * 1000;
  window.__PLANT_SINK__ = acc;
}
/**
 * `&verify=1` (a smoke, never timed): counts batched runs after which the DOM had NOT changed. It must be 0 for every
 * op but noop, or a framework deferred its write past the await and the sample timed less than the op.
 */
const VERIFY = params.has('verify');
const unchanged = {};
/** The fewest runs any batched sample of each op made, reported so a capped op's resolution is visible. */
const runsOf = {};
let before;

/** Resolves once the browser has painted. */
const painted = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

/** Breathing room so one pass's garbage is less likely to land in the next pass's measurement. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const OPERATIONS = [
  { key: 'create1k',  label: 'create 1 000 rows',     setup: (a) => a.clear(),        run: (a) => a.create(1000, 1), rows: 1000 },
  { key: 'create10k', label: 'create 10 000 rows',    setup: (a) => a.clear(),        run: (a) => a.create(10000, 2), rows: 10000 },
  { key: 'append1k',  label: 'append 1 000 to 1 000', setup: (a) => a.create(1000, 3), run: (a) => a.append(1000, 4), rows: 2000 },
  { key: 'update10',  label: 'update every 10th',     setup: (a) => a.create(1000, 5), run: (a) => a.updateEvery10th(), each: (a) => a.updateEvery10th(), fixed: Number(params.get('n10')) || 200 },
  { key: 'select',    label: 'select row',            setup: (a) => a.create(1000, 6), run: (a) => a.select(300), each: (a, k) => a.select(300 + (k % 600)) },
  { key: 'swap',      label: 'swap 2 rows',           setup: (a) => a.create(1000, 7), run: (a) => a.swap(), each: (a) => a.swap() },
  { key: 'remove',    label: 'remove row',            setup: (a) => a.create(1000, 8), run: (a) => a.remove(400), each: (a) => a.remove(400), fixed: 500 },
  { key: 'clear',     label: 'clear 1 000 rows',      setup: (a) => a.create(1000, 9), run: (a) => a.clear() },
  /** Batched runs only: clear can't repeat without a create, so its sample is made tens of ms by size instead. */
  ...(BATCH ? [
    { key: 'noop',     label: `nothing, ${BATCH}× (the floor)`, setup: (a) => a.create(1000, 11), run: () => {}, each: () => {} },
    { key: 'clear10k', label: 'clear 10 000 rows',     setup: (a) => a.create(10000, 12), run: (a) => a.clear() },
    /**
     * **The `-dom` rows** (2026-10-24): the SAME ops re-batched — script + DOM + layout per run, the paint
     * outside, averaged (`rebatch` below) — DISTINCT rows, never a redefinition of the to-paint ones above: the public
     * table and every cross-framework comparison measure to paint, and a change that makes the DOM costlier to style or
     * lay out shows only there. Layout is forced inside each run by DEFAULT here (DOM shape is what changes most).
     */
    { key: 'create1k-dom', label: 'create 1 000 rows, DOM + layout', setup: (a) => a.clear(), run: (a) => a.create(1000, 1), rebatch: 16, plant: true },
    { key: 'append1k-dom', label: 'append 1 000, DOM + layout', setup: (a) => a.create(1000, 3), run: (a) => a.append(1000, 4), rebatch: 16 },
    { key: 'clear-dom', label: 'clear 1 000 rows, DOM + layout', setup: (a) => a.create(1000, 9), run: (a) => a.clear(), rebatch: 8 },
    { key: 'clear10k-dom', label: 'clear 10 000 rows, DOM + layout', setup: (a) => a.create(10000, 12), run: (a) => a.clear(), rebatch: 3 },
  ] : []),
  /** Under `layout`, one row still timed through to paint, as the reference for what the paint-excluded column leaves out. */
  ...(LAYOUT ? [{ key: 'create1k+paint', label: 'create 1 000 rows, to paint', setup: (a) => a.clear(), run: (a) => a.create(1000, 1), paint: true }] : []),
  ...[5, 50].map((k) => ({
    key: `flood${k}`,
    label: `${k} events, each updating every 10th row`,
    setup: (a) => a.create(1000, 10),
    /** K separate tasks back to back (a MessageChannel, so they land inside one frame) — a burst of messages. */
    run: (a) =>
      new Promise((resolve) => {
        const channel = new MessageChannel();
        let i = 0;
        channel.port1.onmessage = () => {
          const done = a.updateEvery10th();
          if (++i < k) channel.port2.postMessage(0);
          else Promise.resolve(done).then(resolve);
        };
        channel.port2.postMessage(0);
      }),
  })),
].filter((op) => {
  /** `?ops=update10,flood50` runs those operations alone; the floods are opt-in, outside the standard table. */
  const ops = new URLSearchParams(location.search).get('ops')?.split(',');
  return ops ? ops.includes(op.key) : !op.key.startsWith('flood');
});

const mount = document.getElementById('mount');
const tbody = document.getElementById('results');
const status = document.getElementById('status');
const runBtn = document.getElementById('run');

/**
 * **Every timed sample of a row-making op must have made its rows** (2026-11-17): a create1k sample 25% faster
 * than its siblings is the shape of a sample that measured nothing, and nothing checked the DOM a sample left. Counted
 * AFTER the timing, before teardown — every `<tr>` under the mount, open shadow roots included — and a wrong count is a
 * row error, which fails the race: a precondition, never part of a reading.
 */
const rowsIn = (root) => {
  let n = root.querySelectorAll('tr').length;
  for (const el of root.querySelectorAll('*')) if (el.shadowRoot) n += rowsIn(el.shadowRoot);
  return n;
};

const cell = (html, cls) => {
  const td = document.createElement('td');
  td.innerHTML = html;
  if (cls) td.className = cls;
  return td;
};

async function measure(impl, op) {
  const timings = [];
  /** The row's own run time from its warm-up runs (unplanted): sizes the per-row plant and the re-batch count. */
  let perRun = 0;
  /** Under `minms`, the first warm-up is ONE run (a cheap size probe) and every warm-up re-sizes the count from its own
   *  per-run time: enough runs to hold MINMS ms of work, 2–32 (the fixed `rebatch` floors are for runs without `minms`). */
  let rebatch = COUNTS[op.key] ?? (MINMS ? 1 : op.rebatch);
  for (let i = 0; i < (CALIBRATE ? WARMUP : WARMUP + REPEATS); i++) {
    if (performance.now() - pageStart > PAGE_MS) throw new Error(`page over its ${PAGE_MS} ms wall limit at ${op.key}`);
    const app = impl.factory(mount);
    resetIds();
    await op.setup(app);
    await painted();
    await settle();

    let dt;
    if (BATCH && op.rebatch) {
      /**
       * **An op that needs fresh state each run, re-batched** (2026-10-24): a create or a clear cannot repeat back to
       * back, so under `?batch` a sample is `rebatch` runs, each set up UNTIMED, each timed until it has written the DOM
       * (as a batched op is), the paint after each outside the sample, and the times averaged. Firefox and WebKit report
       * whole milliseconds: a 10 ms clear read 9, 10 or 11 per sample; averaged over the runs, the rounding averages out
       * (measured, Firefox A/A: clear 9–18% → 0.0%). Only the `-dom` rows carry `rebatch`; layout is forced inside each run.
       */
      let total = 0;
      for (let r = 0; r < rebatch; r++) {
        /** The set-up's paint stays outside the sample; the 30 ms settle is BETWEEN samples only, since every run here is
         *  averaged into one (with it, a 1 ms clear at 30 runs cost ~20 s a row). */
        if (r > 0) {
          await op.setup(app);
          await painted();
        }
        const t0 = performance.now();
        await op.run(app);
        void document.body.offsetHeight;
        /**
         * `&plant=N` — the POSITIVE CONTROL (CLAUDE.md, "a frequency bar, a median bar and a control bar"): N iterations of
         * fixed WORK inside the timed run of the rows marked `plant`, into a global sink the engine cannot drop, sized to the
         * effect a race must be able to see. An arm carrying it must read REAL slower, or that race could not have seen a
         * real loss of that size. Counted work, never a timed wait: Firefox and WebKit coarsen `performance.now()`, so a
         * "100 µs" wait read ~0 or ~1 ms per run. Calibrated once in Node: 13 000 ≈ 100 µs (~7.8 ns each).
         */
        if (PLANT && op.plant) {
          let acc = window.__PLANT_SINK__ | 0;
          for (let i = 0; i < PLANT; i++) acc = (acc * 31 + i) | 0;
          window.__PLANT_SINK__ = acc;
        }
        if (PLANTPCT && i >= WARMUP) spin((perRun * PLANTPCT) / 100);
        total += performance.now() - t0;
        await painted();
      }
      dt = total / rebatch;
      if (i < WARMUP && MINMS && !(op.key in COUNTS)) rebatch = Math.min(MAXREBATCH, Math.max(2, Math.ceil(MINMS / Math.max(dt, 0.05))));
    } else if (!(BATCH && op.each)) {
      const t0 = performance.now();
      await op.run(app); // resolves when this framework has finished writing the DOM
      if (LAYOUT && !op.paint) {
        /**
         * Under `layout`, a heavy op is script + DOM + layout, and the paint's frame wait is outside the sample:
         * headed Chrome landed whole frames in it (create10k ~220 or ~445 ms by session, clear10k 35 or 70). Paint is
         * then excluded for every framework, and the painted DOM is identical (the parity probe), so its cost is too.
         */
        void document.body.offsetHeight;
        dt = performance.now() - t0;
        await painted();
      } else {
        await painted();
        dt = performance.now() - t0;
      }
    } else {
      /** The paint is OUTSIDE a batched sample: a frame's wait spread over N runs was as large as the op itself. */
      const fixedN = COUNTS[op.key] ?? op.fixed;
      const t0 = performance.now();
      let k = 0;
      do {
        if (VERIFY) before = mount.innerHTML;
        await op.each(app, k++);
        if (LAYOUT) void document.body.offsetHeight;
        if (PLANTPCT && i >= WARMUP) spin((perRun * PLANTPCT) / 100);
        if (VERIFY && mount.innerHTML === before) unchanged[op.key] = (unchanged[op.key] ?? 0) + 1;
      } while (fixedN ? k < fixedN : k < (op.cap ?? Infinity) && performance.now() - t0 < BATCH);
      dt = (performance.now() - t0) / k;
      runsOf[op.key] = Math.min(runsOf[op.key] ?? Infinity, k);
      await painted();
    }

    if (op.rows !== undefined && !(BATCH && op.each)) {
      const made = rowsIn(mount);
      if (made !== op.rows) (window.__ROW_ERRORS__ ??= []).push(`${impl.name} / ${op.key}: sample ${i} left ${made} rows, expected ${op.rows}`);
    }
    app.teardown();
    mount.textContent = '';
    if (i < WARMUP) perRun = dt; // the last warm-up's per-run time, unplanted
    if (i >= WARMUP) timings.push(dt);
    await settle();
  }
  /** Calibration: a re-batched row's count as its warm-ups sized it; a batched row's, enough ops to hold the sample's work. */
  if (CALIBRATE && BATCH && (op.rebatch || op.each))
    (window.__COUNTS__ ??= {})[op.key] = op.rebatch ? rebatch : Math.min(5000, Math.max(2, Math.ceil((MINMS || BATCH) / Math.max(perRun, 0.001))));
  return { median: median(timings), min: Math.min(...timings), max: Math.max(...timings), timings };
}

async function runAll() {
  runBtn.disabled = true;
  tbody.textContent = '';
  const results = {};
  const total = OPERATIONS.length * IMPLEMENTATIONS.length;
  let done = 0;

  /** Each row's wall time on this page (set-ups, paints and settles included): what sizes a race's rows and its bound. */
  const rowMs = (window.__ROW_MS__ = {});
  for (const [opIndex, op] of OPERATIONS.entries()) {
    results[op.key] = {};
    const rowStart = performance.now();

    /** Rotate the starting framework so running first is not a fixed advantage or penalty. */
    const order = IMPLEMENTATIONS.map((_, i) => IMPLEMENTATIONS[(i + opIndex) % IMPLEMENTATIONS.length]);

    for (const impl of order) {
      status.textContent = `${op.label} — ${impl.name}…  (${++done}/${total})`;
      await new Promise((r) => setTimeout(r, 0));
      try {
        results[op.key][impl.name] = await measure(impl, op);
      } catch (err) {
        /** Past the wall limit the page stops; any other failure is still a row the race cannot read, so it is reported
         *  (`__ROW_ERRORS__`, which fails the race) rather than left as a silent NaN. */
        if (performance.now() - pageStart > PAGE_MS) throw err;
        results[op.key][impl.name] = null;
        (window.__ROW_ERRORS__ ??= []).push(`${impl.name} / ${op.key}: ${err?.message ?? err}`);
        console.error(`${impl.name} / ${op.key}`, err);
      }
      mount.textContent = '';
    }
    rowMs[op.key] = Math.round(performance.now() - rowStart);
    /** A calibration page only sizes counts (`__COUNTS__`): it has no samples to show. */
    if (CALIBRATE) continue;

    const row = document.createElement('tr');
    row.appendChild(cell(op.label));
    const mins = IMPLEMENTATIONS.map((i) => results[op.key][i.name]?.min).filter((t) => t != null);
    const best = Math.min(...mins);

    for (const impl of IMPLEMENTATIONS) {
      const r = results[op.key][impl.name];
      if (!r) { row.appendChild(cell('failed', 'num bad')); continue; }

      /** A median far above the minimum means this framework allocated enough to provoke collection. */
      const churn = r.median > r.min * 1.6;
      const td = cell(
        `${r.min.toFixed(1)} ms` +
          `<span class="range${churn ? ' noisy' : ''}">med ${r.median.toFixed(0)}</span>`,
        r.min === best ? 'num best' : 'num'
      );
      td.title =
        `fastest ${r.min.toFixed(1)} ms · median ${r.median.toFixed(1)} ms · slowest ${r.max.toFixed(1)} ms` +
        (churn ? ' — median well above the minimum, so this run provoked collection' : '');
      row.appendChild(td);
    }
    tbody.appendChild(row);
  }

  status.textContent =
    'Done. Lower is better. Headline is the fastest run; "med" underneath is the median.';
  runBtn.disabled = false;
  /** Each batched op less the floor, per op: `noop` measures the awaits, the loop and the paint's share. */
  if (results.noop)
    for (const op of OPERATIONS)
      if (op.each && op.key !== 'noop')
        results[`${op.key}:net`] = Object.fromEntries(IMPLEMENTATIONS.map((i) => {
          const r = results[op.key][i.name], floor = results.noop[i.name];
          return [i.name, r && floor ? { median: r.median - floor.median, min: r.min - floor.min, max: r.max - floor.max } : null];
        }));
  if (VERIFY) window.__UNCHANGED__ = unchanged;
  window.__RUNS__ = runsOf;
  window.__RESULTS__ = results;
  console.log(JSON.stringify(results, null, 2));
}

const head = document.getElementById('head');
head.appendChild(document.createElement('th')).textContent = 'Operation';
for (const impl of IMPLEMENTATIONS) {
  const th = document.createElement('th');
  th.className = 'num';
  th.innerHTML = `${impl.name}<span class="note">${impl.note}</span>`;
  head.appendChild(th);
}

/** A page that throws (its wall limit, or a framework error) reports it, so the race fails loudly instead of waiting. */
runBtn.addEventListener('click', () => runAll().catch((error) => { window.__PAGE_ERROR__ = String(error?.message ?? error); }));
status.textContent = 'Ready.';
