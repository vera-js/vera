/**
 * Reactivity benchmark for @verajs/core.
 *
 * Measures the SHIPPED bundle (`packages/core/dist/vera.min.js`), not source, so numbers reflect
 * what a consumer actually runs. Requires `npm run build` first.
 *
 *   node bench/reactivity.mjs
 *   node bench/reactivity.mjs --json          # machine-readable, for before/after diffing
 *   node bench/reactivity.mjs --baseline f    # write results to f
 *   node bench/reactivity.mjs --compare f     # compare against a previous run
 *
 * Runs under jsdom on V8. Proxy, allocation and Map costs are representative of a browser;
 * layout and paint are not modelled.
 *
 * The tracked/untracked split matters: `addCallback` returns early when no hook is on the
 * queue, so reads outside a hook skip dependency registration entirely. Only the tracked
 * numbers describe what happens inside a real render.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1] ?? true;
};
const asJson = args.includes('--json');

/** Convert a standalone ESM bundle into an IIFE returning its exports. */
const toIIFE = (name, file) => {
  const src = readFileSync(file, 'utf8');
  const all = [...src.matchAll(/export\s*\{([^}]*)\}\s*;?/g)];
  if (!all.length) throw new Error(`no export statement in ${file}`);
  const m = all[all.length - 1];
  const returned = m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const p = s.split(/\s+as\s+/);
      return p.length === 2 ? `${p[1].trim()}:${p[0].trim()}` : `${s}:${s}`;
    })
    .join(',');
  return `const ${name} = (() => {\n${src.slice(0, m.index)}\nreturn {${returned}};\n})();`;
};

const CORE = 'packages/core/dist/vera.min.js';
if (!existsSync(CORE)) {
  console.error(`Missing ${CORE} — run \`npm run build\` first.`);
  process.exit(1);
}

const dom = new JSDOM('<!doctype html><body></body>', {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});

const results = dom.window.eval(`(() => {
  ${toIIFE('Vera', CORE)}
  const { createStore, init, useEffect } = Vera;

  const N = 200000;
  let sink = 0;

  /** Median of several passes; JIT warmup discarded. */
  const time = (fn, passes = 5) => {
    for (let i = 0; i < 2; i++) fn();            // warm
    const runs = [];
    for (let i = 0; i < passes; i++) {
      const t = performance.now();
      fn();
      runs.push(performance.now() - t);
    }
    runs.sort((a, b) => a - b);
    return runs[Math.floor(runs.length / 2)];
  };

  const store = createStore({ flat: 1, nested: { deep: { value: 1 } } });
  const plain = { flat: 1, nested: { deep: { value: 1 } } };

  /* ---- untracked: no hook on the queue, addCallback bails early ---------- */
  const plainFlat    = time(() => { for (let i=0;i<N;i++) sink += plain.flat; });
  const plainNested  = time(() => { for (let i=0;i<N;i++) sink += plain.nested.deep.value; });
  const unFlat       = time(() => { for (let i=0;i<N;i++) sink += store.flat; });
  const unNested     = time(() => { for (let i=0;i<N;i++) sink += store.nested.deep.value; });

  /* ---- tracked: inside a live hook, dependency registration runs --------- */
  const el = document.createElement('div');
  document.body.appendChild(el);
  init(el);

  let trFlat = 0, trNested = 0;
  useEffect(() => {
    trFlat   = time(() => { for (let i=0;i<N;i++) sink += store.flat; }, 3);
    trNested = time(() => { for (let i=0;i<N;i++) sink += store.nested.deep.value; }, 3);
  });
  el.runHooks();

  /* ---- tracked WITH an insert registered --------------------------------
     Measures the cost of ANY registered proxy-handler insert (a passthrough here — map
     support itself is in core now). Insert chains are walked on every
     read, so how they are stored shows up here and nowhere else.                              */
  Vera.wire({ on: 'proxy-handler', fn: (obj, prop, value) => value, priority: 50 });
  const iEl = document.createElement('div');
  document.body.appendChild(iEl);
  init(iEl);
  const iStore = createStore({ flat: 1, nested: { deep: { value: 1 } } });
  let inFlat = 0, inNested = 0;
  useEffect(() => {
    inFlat   = time(() => { for (let i=0;i<N;i++) sink += iStore.flat; }, 3);
    inNested = time(() => { for (let i=0;i<N;i++) sink += iStore.nested.deep.value; }, 3);
  });
  iEl.runHooks();

  /* ---- write + propagation ---------------------------------------------- */
  const W = 20000;
  const wEl = document.createElement('div');
  document.body.appendChild(wEl);
  init(wEl);
  const wStore = createStore({ n: 0 });
  let fired = 0;
  useEffect(() => { wStore.n; fired++; });
  wEl.runHooks();
  const writes = time(() => { for (let i=0;i<W;i++) wStore.n = i; }, 3);

  /* ---- identity --------------------------------------------------------- */
  const idFlat = store.nested === store.nested;
  const idDeep = store.nested.deep === store.nested.deep;

  return {
    N, W, sink,
    metrics: {
      'plain object, flat':        plainFlat,
      'plain object, 2 hops':      plainNested,
      'store untracked, flat':     unFlat,
      'store untracked, 2 hops':   unNested,
      'store TRACKED, flat':       trFlat,
      'store TRACKED, 2 hops':     trNested,
      'tracked + insert, flat':    inFlat,
      'tracked + insert, 2 hops':  inNested,
      'writes + propagation':      writes,
    },
    identity: { 'nested === nested': idFlat, 'deep === deep': idDeep },
  };
})()`);

const ns = (ms, n) => (ms * 1e6) / n;

if (asJson) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.log(`\n  ${results.N.toLocaleString()} reads / ${results.W.toLocaleString()} writes, median of 5\n`);
  const pad = Math.max(...Object.keys(results.metrics).map((k) => k.length));
  for (const [k, ms] of Object.entries(results.metrics)) {
    const n = k.startsWith('writes') ? results.W : results.N;
    console.log(`  ${k.padEnd(pad)}  ${ms.toFixed(1).padStart(7)} ms   ${ns(ms, n).toFixed(0).padStart(6)} ns/op`);
  }
  console.log('');
  for (const [k, v] of Object.entries(results.identity)) {
    console.log(`  ${k.padEnd(pad)}  ${v ? 'stable' : 'UNSTABLE'}`);
  }
  console.log('');
}

const out = flag('--baseline');
if (typeof out === 'string') {
  writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(`  baseline written to ${out}\n`);
}

const cmp = flag('--compare');
if (typeof cmp === 'string') {
  const before = JSON.parse(readFileSync(cmp, 'utf8'));
  console.log(`  vs ${cmp}\n`);
  const pad = Math.max(...Object.keys(results.metrics).map((k) => k.length));
  for (const [k, after] of Object.entries(results.metrics)) {
    const b = before.metrics[k];
    if (b == null) continue;
    const n = k.startsWith('writes') ? results.W : results.N;
    const delta = ((after - b) / b) * 100;
    const mark = delta < -5 ? 'faster' : delta > 5 ? 'SLOWER' : 'same';
    console.log(
      `  ${k.padEnd(pad)}  ${ns(b, n).toFixed(0).padStart(6)} -> ${ns(after, n).toFixed(0).padStart(6)} ns` +
        `   ${(delta > 0 ? '+' : '') + delta.toFixed(0)}%  ${mark}`
    );
  }
  console.log('');
}
