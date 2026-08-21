/**
 * Runner for the DOM benchmark.
 *
 * Getting this wrong is easy and quiet, so the design is deliberately defensive:
 *
 * - **Every framework declares when its DOM work is done.** Each operation returns a promise that
 *   resolves once that framework has written the DOM; only then does the runner wait for paint.
 *   Without this the comparison silently favoured whichever library exposed a completion promise —
 *   Lit's `updateComplete` resolved after its microtask had already mutated the DOM, leaving it the
 *   rest of the frame to lay out, while a framework that schedules on an animation frame had its
 *   work land inside the measurement window instead.
 *
 * - **Order is rotated.** The framework that runs first for an operation changes each time, so
 *   position in the sequence — cold caches, garbage left by the previous run — cannot consistently
 *   favour or penalise one of them.
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
import { IMPLEMENTATIONS, resetIds } from './impls.js';

const REPEATS = 7;
const WARMUP = 2;

/** Resolves once the browser has painted. */
const painted = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

/** Breathing room so one pass's garbage is less likely to land in the next pass's measurement. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const OPERATIONS = [
  { key: 'create1k',  label: 'create 1 000 rows',     setup: (a) => a.clear(),        run: (a) => a.create(1000, 1) },
  { key: 'create10k', label: 'create 10 000 rows',    setup: (a) => a.clear(),        run: (a) => a.create(10000, 2) },
  { key: 'append1k',  label: 'append 1 000 to 1 000', setup: (a) => a.create(1000, 3), run: (a) => a.append(1000, 4) },
  { key: 'update10',  label: 'update every 10th',     setup: (a) => a.create(1000, 5), run: (a) => a.updateEvery10th() },
  { key: 'select',    label: 'select row',            setup: (a) => a.create(1000, 6), run: (a) => a.select(300) },
  { key: 'swap',      label: 'swap 2 rows',           setup: (a) => a.create(1000, 7), run: (a) => a.swap() },
  { key: 'remove',    label: 'remove row',            setup: (a) => a.create(1000, 8), run: (a) => a.remove(400) },
  { key: 'clear',     label: 'clear 1 000 rows',      setup: (a) => a.create(1000, 9), run: (a) => a.clear() },
];

const mount = document.getElementById('mount');
const tbody = document.getElementById('results');
const status = document.getElementById('status');
const runBtn = document.getElementById('run');

const cell = (html, cls) => {
  const td = document.createElement('td');
  td.innerHTML = html;
  if (cls) td.className = cls;
  return td;
};

async function measure(impl, op) {
  const timings = [];
  for (let i = 0; i < WARMUP + REPEATS; i++) {
    const app = impl.factory(mount);
    resetIds();
    await op.setup(app);
    await painted();
    await settle();

    const t0 = performance.now();
    await op.run(app); // resolves when this framework has finished writing the DOM
    await painted();
    const dt = performance.now() - t0;

    app.teardown();
    mount.textContent = '';
    if (i >= WARMUP) timings.push(dt);
    await settle();
  }
  return { median: median(timings), min: Math.min(...timings), max: Math.max(...timings) };
}

async function runAll() {
  runBtn.disabled = true;
  tbody.textContent = '';
  const results = {};
  const total = OPERATIONS.length * IMPLEMENTATIONS.length;
  let done = 0;

  for (const [opIndex, op] of OPERATIONS.entries()) {
    results[op.key] = {};

    /** Rotate the starting framework so running first is not a fixed advantage or penalty. */
    const order = IMPLEMENTATIONS.map((_, i) => IMPLEMENTATIONS[(i + opIndex) % IMPLEMENTATIONS.length]);

    for (const impl of order) {
      status.textContent = `${op.label} — ${impl.name}…  (${++done}/${total})`;
      await new Promise((r) => setTimeout(r, 0));
      try {
        results[op.key][impl.name] = await measure(impl, op);
      } catch (err) {
        results[op.key][impl.name] = null;
        console.error(`${impl.name} / ${op.key}`, err);
      }
      mount.textContent = '';
    }

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

runBtn.addEventListener('click', runAll);
status.textContent = 'Ready.';
