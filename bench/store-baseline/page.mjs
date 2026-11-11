/**
 * Page driver for the store baseline (step (b)): the same `rows.mjs` in a real engine, ONE fresh browser per page (a
 * page's garbage never lands in the next one's window), the arm order rotated each round. Headless to iterate; `--headed`
 * for the one confirmation run (CLAUDE.md: time in headed browsers). Arms as `compare.mjs` stages them.
 * Usage: node bench/store-baseline/page.mjs <chrome|firefox|webkit|chromium> [rounds=3] [--headed]
 *   ARMS="label=path,…" races other bundles (the FIRST is the base; its byte A/A is staged beside it); ROWS=hooks runs the
 *   hook rows (hook-rows.mjs) instead of the store rows. Every round's arm order is a seeded shuffle, printed.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import { MIN_SAMPLE } from './rows.mjs';
import { holdRaceLock } from '../race-lock.mjs';

const root = new URL('../../', import.meta.url).pathname;
/** Held while this page driver times: builds, typecheck and lint refuse under it (`../race-lock.mjs`). */
holdRaceLock(root, 'bench/store-baseline/page.mjs');
const [engine = 'firefox', roundsArg = '3'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const rounds = Number(roundsArg);
const headed = process.argv.includes('--headed');
const HOOKS = process.env.ROWS === 'hooks';
/** ROWS=computed: `computed-rows.mjs`. An arm is `core.min.js` or `core.min.js+computed.min.js` (an entry that keeps
 *  core external): the page maps `@verajs/core` to THAT arm's core, so both files load as published, byte for byte. */
const COMPUTED = process.env.ROWS === 'computed';
const ARMS = process.env.ARMS
  ? (() => {
      const list = process.env.ARMS.split(',').map((a) => a.split('='));
      const [baseLabel, basePath] = list[0];
      const [baseCore, ...baseRest] = basePath.split('+');
      const aa = `.probe/page-${baseLabel}-aa.min.js`;
      writeFileSync(join(root, aa), readFileSync(join(root, baseCore)));
      return { [baseLabel]: basePath, [`${baseLabel} A/A`]: [aa, ...baseRest].join('+'), ...Object.fromEntries(list.slice(1)) };
    })()
  : {
      S: 'packages/core/dist/vera.min.js',
      ref: '.probe/additive/ref/core/vera.min.js',
      'ref A/A': '.probe/baseline/ref-aa.min.js',
      plant: '.probe/baseline/ref-plant.min.js',
    };
for (const f of Object.values(ARMS).flatMap((a) => a.split('+'))) if (!existsSync(join(root, f))) throw new Error(`missing ${f}: run compare.mjs first (it stages the A/A and the plant)`);
/** The page runs with the reps handed in its query (calibrated once on the reference in THIS engine), or calibrates them. */
const PAGE = (arm) => {
  const [bundle, extra] = arm.split('+');
  return `<!doctype html><script type="importmap">{"imports":{"@verajs/core":"/${bundle}"}}</script><script type="module">
import * as core from '/${bundle}';
import { run } from '/bench/store-baseline/rows.mjs';
import { runHooks } from '/bench/store-baseline/hook-rows.mjs';
import { runComputed } from '/bench/store-baseline/computed-rows.mjs';
const all = ${extra ? `{ ...core, ...(await import('/${extra}')) }` : 'core'};
const q = new URLSearchParams(location.search).get('reps');
window.__result = (${COMPUTED} ? runComputed : ${HOOKS} ? runHooks : run)(all, () => performance.now(), q ? JSON.parse(q) : undefined, ${JSON.stringify(process.env.ONLY ? process.env.ONLY.split(',') : undefined)});
</script>`;
};
const server = createServer((q, r) => {
  const url = decodeURIComponent(q.url.split('?')[0]);
  if (url.startsWith('/page/')) return r.writeHead(200, { 'content-type': 'text/html' }), r.end(PAGE(url.slice(6)));
  const p = join(root, url);
  if (!existsSync(p)) return r.writeHead(404), r.end();
  r.writeHead(200, { 'content-type': extname(p) === '.mjs' || extname(p) === '.js' ? 'text/javascript' : 'text/plain' });
  r.end(readFileSync(p));
});
await new Promise((res) => server.listen(8277, res));
/** `chrome` is the INSTALLED Chrome (CLAUDE.md: time in the browsers people use), through Playwright's chromium with its channel. */
const type = { chromium, chrome: chromium, firefox, webkit }[engine];
const launchOpts = { headless: !headed, ...(engine === 'chrome' ? { channel: 'chrome' } : {}) };
/** The races' gates: a quiet start (nothing foreign above 10% of a core, VOID after 10 minutes) and thermal pressure 0
 *  before every page (cooling while it is not). The OS's indexing daemons (fseventsd, Spotlight, media analysis) never
 *  block a race (Brian, 2026-10-17): they wake on the files a build writes, the A/A copy carries their noise, and thermal
 *  pressure stays the gate (two runs were VOID on fseventsd alone, 2026-10-28). */
import { execSync } from 'node:child_process';
const thermal = () => Number(execSync('notifyutil -g com.apple.system.thermalpressurelevel').toString().trim().split(/\s+/).pop());
/** This process is never foreign: `comm` prints a bare `node`, so the `store-baseline` exemption below cannot match it, and a
 *  harness just started reads high enough to flag itself (2026-10-31). */
const foreign = () => execSync('ps -Ao pid=,pcpu=,comm= -r', { encoding: 'utf8' }).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith(`${process.pid} `)).slice(0, 11).map((l) => l.slice(l.indexOf(' ') + 1).trim())
  .filter((l) => parseFloat(l) > 10 && !/Code Helper|\/claude$|native-binary\/claude|WindowServer|\bps$|store-baseline|firefox|webkit|Chrom|Playwright|fseventsd|corespotlightd|\/mds$|mds_stores|mdworker|mediaanalysisd/i.test(l));
/** **A settle after the last build** (CLAUDE.md: a few minutes after the last build before any timing run): the youngest
 *  arm bundle must be SETTLE_MS old before the first page, its age printed. The daemon exemption above is not a license
 *  to race straight off a build. */
const SETTLE_MS = 180000;
/** The harness and rows this engine runs, by sha: a chain loads them once PER ENGINE, so an edit between engines shows here. */
{
  const { createHash } = await import('node:crypto');
  const sha = (f) => createHash('sha256').update(readFileSync(join(root, f))).digest('hex').slice(0, 12);
  console.log(`harness: page.mjs ${sha('bench/store-baseline/page.mjs')}, rows.mjs ${sha('bench/store-baseline/rows.mjs')}, hook-rows.mjs ${sha('bench/store-baseline/hook-rows.mjs')}, computed-rows.mjs ${sha('bench/store-baseline/computed-rows.mjs')}`);
}
{
  /** The staged A/A copy is written by this run itself, so it is not a build: only the arms' own files count. */
  const youngest = Math.max(...Object.entries(ARMS).filter(([n]) => !n.endsWith(' A/A')).flatMap(([, a]) => a.split('+')).map((f) => statSync(join(root, f)).mtimeMs));
  const wait = youngest + SETTLE_MS - Date.now();
  console.log(`youngest arm bundle built ${((Date.now() - youngest) / 60000).toFixed(1)} min ago${wait > 0 ? `: settling ${Math.ceil(wait / 1000)} s` : ''}`);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
{
  /** ONE reading decides: the loop leaving on a quiet reading and a second `ps` voiding on a spike printed "after 10 min" at
   *  2 minutes (2026-10-31). */
  const t0 = Date.now();
  let busy, hot;
  while ((busy = foreign(), hot = thermal(), busy.length || hot > 0) && Date.now() - t0 < 600000) await new Promise((r) => setTimeout(r, 15000));
  if (busy.length || hot > 0) { console.log(`UNQUIET after ${((Date.now() - t0) / 60000).toFixed(1)} min — VOID: ${JSON.stringify(busy)}, thermal ${hot}`); process.exit(3); }
  console.log(`quiet start: nothing foreign above 10%, thermal ${thermal()}`);
}
const cool = async () => { while (thermal() > 0) await new Promise((r) => setTimeout(r, 15000)); };
{ const b = await type.launch(launchOpts); console.log(`engine: ${engine} ${b.version()} ${headed ? 'HEADED' : 'headless (iteration only)'}`); await b.close(); }
const visit = async (bundle, query = '') => {
  await cool();
  const br = await type.launch(launchOpts);
  const page = await br.newPage();
  /** `commit`, not `load`: the bench runs in the module script, which holds `load` past goto's own timeout (WebKit, 2026-10-26). */
  await page.goto(`http://localhost:8277/page/${bundle}${query}`, { waitUntil: 'commit', timeout: 60000 });
  const res = await page.waitForFunction(() => window.__result, null, { timeout: 600000 }).then((h) => h.jsonValue());
  await br.close();
  return res.rows;
};
/** Reps calibrated ONCE per row on the reference IN THIS ENGINE, then the same for every arm. */
const names = Object.keys(ARMS);
const baseArm = process.env.ARMS ? names[0] : 'ref';
const calibrated = await visit(ARMS[baseArm]);
/**
 * The calibrated reps are judged by the sample they MEASURED (`sampleMs`, the median of the timed passes at those reps),
 * not by the one sample that chose them: a collection landing in that sample makes it read long and the reps too few
 * (2026-10-29, Firefox teardown: 16 reps, a 6 ms median, VOID). A row measuring under MIN_SAMPLE has its reps scaled
 * to clear it with a 1.5× margin, once, before any arm runs; an arm's sample under VOID_BELOW still reports VOID.
 */
const reps = Object.fromEntries(
  Object.entries(calibrated).map(([k, v]) => [k, v.sampleMs < MIN_SAMPLE ? v.reps * Math.ceil((1.5 * MIN_SAMPLE) / Math.max(v.sampleMs, 0.5)) : v.reps]),
);
/** REPS='{"11":2048}': a row's reps forced by label, for a sample-length probe (2026-10-31: one row read 60 or 116 us per rep depending on them). */
for (const [label, n] of Object.entries(JSON.parse(process.env.REPS ?? '{}'))) {
  const key = Object.keys(reps).find((k) => k.startsWith(`${label} `));
  if (key === undefined) throw new Error(`REPS: no row ${label}`);
  reps[key] = n;
}
console.log('reps per row (calibrated once on the reference in this engine, used by every arm), and the calibration sample:');
for (const [k, n] of Object.entries(reps))
  console.log(`  ${String(n).padStart(6)}  ${k}  (sample ${calibrated[k].sampleMs.toFixed(1)} ms at ${calibrated[k].reps}${n !== calibrated[k].reps ? `; scaled to ${n}` : ''})`);
const repsQuery = `?reps=${encodeURIComponent(JSON.stringify(reps))}`;
const R = Object.fromEntries(names.map((n) => [n, []]));
/** A SEEDED SHUFFLE per round (mulberry32 + Fisher–Yates), never a rotation, which keeps each arm beside one neighbor. */
const shuffle = (list, seed) => { let t = seed >>> 0; const rand = () => { t = (t + 0x6d2b79f5) >>> 0; let x = Math.imul(t ^ (t >>> 15), 1 | t); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; const o = [...list]; for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; } return o; };
for (let r = 0; r < rounds; r++) {
  const order = shuffle(names, 0x9e3779b9 ^ (r + 1));
  for (const n of order) R[n].push(await visit(ARMS[n], repsQuery));
  console.log(`round ${r + 1}/${rounds} done: ${order.join(', ')}`);
}
server.close();
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
/** ARMS given: every other arm against the base AND its byte A/A, per round; every round's values kept beside them. */
if (process.env.ARMS) {
  writeFileSync(join(root, `.probe/page-rounds-${engine}-${COMPUTED ? 'computed' : HOOKS ? 'hooks' : 'store'}.json`), JSON.stringify(R));
  const base = names[0], aaName = `${base} A/A`;
  for (const row of Object.keys(R[base][0])) {
    const v = (n) => R[n].map((x) => x[row].median);
    const b = v(base), a = v(aaName);
    const spread = Math.abs(med(a.map((x, i) => x / b[i])) - 1);
    const shortest = Math.min(...names.flatMap((n) => R[n].map((x) => x[row].sampleMs)));
    const others = names.slice(2).map((n) => {
      const t = v(n);
      return `${n} ${med(t.map((x, i) => x / b[i])).toFixed(3)} / ${med(t.map((x, i) => x / a[i])).toFixed(3)} slower-both ${t.filter((x, i) => x > b[i] && x > a[i]).length}/${t.length} faster-both ${t.filter((x, i) => x < b[i] && x < a[i]).length}/${t.length}`;
    });
    const voidWhy = shortest < 20 ? `VOID (a ${shortest.toFixed(1)} ms sample)` : spread > 0.03 ? `VOID (A/A ${(spread * 100).toFixed(1)}%)` : '';
    console.log(`${row.padEnd(46)} A/A ${(spread * 100).toFixed(1).padStart(4)}%  ${voidWhy || others.join(' | ')}`);
  }
  server.close();
  process.exit(0);
}
console.log(`\n${'row'.padEnd(64)} ${'S'.padStart(8)} ${'ref'.padStart(8)}   S/ref   A/A    plant/ref  reading`);
for (const row of Object.keys(R.S[0])) {
  const v = (n) => R[n].map((x) => x[row].median);
  const s = med(v('S')), f = med(v('ref')), a = med(v('ref A/A')), p = med(v('plant'));
  const spread = Math.abs(a / f - 1);
  /** A row whose sample is shorter than the clock can resolve measures ticks, not code: VOID, never read. */
  const shortest = Math.min(...names.flatMap((n) => R[n].map((x) => x[row].sampleMs)));
  if (shortest < 20) { console.log(`${row.padEnd(64)} VOID: a sample of ${shortest.toFixed(1)} ms is under the clock's resolution`); continue; }
  const slowerAll = v('S').every((x, i) => x > v('ref')[i] * (1 + spread));
  const fasterAll = v('S').every((x, i) => x < v('ref')[i] * (1 - spread));
  console.log(`${row.padEnd(64)} ${s.toFixed(3).padStart(8)} ${f.toFixed(3).padStart(8)}   ${(s / f).toFixed(2).padStart(5)}  ${(spread * 100).toFixed(1).padStart(4)}%   ${(p / f).toFixed(2).padStart(6)}     ${slowerAll ? 'GAP (S slower in every page)' : fasterAll ? 'S faster in every page' : 'within the spread / mixed'}`);
}
const plantSeen = ['1 record read, untracked', '4 nested read, 2 hops', '5 array index read, tracked'].every((row) => med(R.plant.map((x) => x[row].median)) > med(R.ref.map((x) => x[row].median)) * 1.03);
console.log(`\nPLANT ${plantSeen ? 'SEEN (≥ +3% on rows 1, 4, 5): the run is valid' : 'NOT SEEN on rows 1, 4, 5: the run is VOID'}`);
