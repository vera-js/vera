/**
 * **Builds raced on the DOM benchmark, three engines, typical case** (the scheduler, 2026-10-08).
 *
 *   node bench/dom/race.mjs <sessions> <variant=bundle.js>... [--only=VeraJS own,VeraJS default] [--engines=chrome,firefox,webkit]
 *
 * Each variant is a bundle `build.mjs` wrote; the page loads it in place of `bundle.js`. Per session, every variant runs
 * once per engine (order rotated), and each operation's MEDIAN of the page's repeats is kept. Reported: the median of
 * the session medians per variant, the change against the first variant, and how many sessions it was faster in — the
 * typical case, never a best-of-N. Name a byte-identical copy as a variant for the A/A control. Chrome is the installed
 * one, headed; the race waits for a quiet machine before each session. A variant may carry a query for the page
 * (`'slots=bundle.js?vera=slots'`, QUOTED: zsh globs an unquoted `?` and the race never starts), so one bundle can be
 * raced wired two ways. **Every page gets a fresh browser**
 * (2026-10-18): same-site pages in one Firefox share a content process, so a page's garbage was collected inside the
 * next page's timed window and results followed the rotation, not the code.
 */
import { chromium, firefox, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { holdRaceLock } from '../race-lock.mjs';
import { harnessSha } from './harness-sha.mjs';

const args = process.argv.slice(2);
const sessions = Number(args[0]);
const variants = args.slice(1).filter((a) => !a.startsWith('--')).map((a) => { const at = a.indexOf('='); const [file, query = ''] = a.slice(at + 1).split('?'); return [a.slice(0, at), file, query]; });
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const only = flag('only') ?? 'VeraJS own,VeraJS default';
const ops = flag('ops');
/**
 * **One implementation per fresh browser** (2026-10-18): implementations sharing a page left their garbage in
 * the next one's timed window, and a rotation that was the same every session put each behind the same neighbor (the
 * A/A split 5/5: clear10k 70 vs 35 ms). Each (variant, implementation) page is its own browser now, in a seeded order
 * per session, so the A/A is two independent browsers running the same bundle.
 */
const impls = only.split(',');
const shuffle = (list, seed) => {
  let x = (seed + 1) * 2654435761 >>> 0;
  const rand = () => ((x = (x ^ (x << 13)) >>> 0, x = (x ^ (x >>> 17)) >>> 0, x = (x ^ (x << 5)) >>> 0) / 4294967296);
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
};
const engines = (flag('engines') ?? 'chrome,firefox,webkit').split(',');
/**
 * `--subset=variant:implA|implB;…` (2026-10-25, the field race): a named variant runs ONLY those implementations — an A/A
 * copy or a planted control of Vera's bundle need not run every framework again (it would double a 4-hour race).
 */
const subset = Object.fromEntries((flag('subset') ?? '').split(';').filter(Boolean).map((e) => { const at = e.indexOf(':'); return [e.slice(0, at), e.slice(at + 1).split('|')]; }));
for (const [v, list] of Object.entries(subset)) for (const i of list) if (!impls.includes(i)) throw new Error(`--subset ${v}: ${i} is not in --only`);
const directory = new URL('.', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript' };
/**
 * **`--coi`: the page is cross-origin isolated** (COOP same-origin + COEP require-corp), which is what lets an engine give
 * `performance.now()` its fine resolution (2026-11-08, the high-resolution-timer step), and Firefox is launched with
 * `privacy.reduceTimerPrecision` off. Each page reports `crossOriginIsolated` and the tick it observes; the race prints them.
 */
const COI = args.includes('--coi');
const ISOLATION = COI ? { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' } : {};
const server = createServer((request, response) => {
  const url = decodeURIComponent(request.url.split('?')[0]);
  const path = join(directory, url === '/' ? 'index.html' : url);
  if (!existsSync(path)) return response.writeHead(404), response.end();
  response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream', ...ISOLATION });
  response.end(readFileSync(path));
});
await new Promise((resolve) => server.listen(8098, resolve));

/** OS daemons are ignored, never waited on (Brian, 2026-10-18): media/photo analysis and Spotlight run when they like. */
/**
 * Processes a race does not wait for. **VS Code's `Code Helper` is NOT exempt** (Brian, 2026-11-05): it held 15-97% of a core
 * at the start of several 2026-11-05 sessions while the old list let them run as "quiet". `WindowServer` stays exempt (the
 * headed browsers drive it themselves), and so does `claude`, the session that runs the race. **Nor is `node`** (2026-11-05,
 * Brian via "whatever you recommend"): a build, a test run or another probe beside a race was invisible to this check. Only
 * THIS process and its descendants (the page server, Playwright's driver) are skipped, by PID.
 */
const BASELINE = /claude|WindowServer|\/ps$|Google Chrome|firefox|Firefox|WebKit|Playwright|mediaanalysisd|photoanalysisd|mds|mdworker|mds_stores|corespotlightd|spotlightknowledged|fseventsd|ospredictiond|ecosystemd|EcosystemAnalytics/;
/** The whole race's quiet-machine waiting, bounded (2026-11-08): it is in the projected wall time, and a session that
 *  starts once it is spent is marked contended (the A/A arm is the defense) rather than waited for. */
const QUIET_BUDGET_MS = 90000;
let quietLeft = QUIET_BUDGET_MS;
const quiet = async () => {
  for (;;) {
    /** Our own process tree, by PID: a `node` there is the harness itself, never something to wait for. */
    const all = execSync('ps -Ao pid=,ppid=,pcpu=,comm= -r').toString().trim().split('\n').map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(.*)$/)).filter(Boolean);
    const ours = new Set([process.pid]);
    for (let grew = true; grew; ) { grew = false; for (const m of all) if (!ours.has(Number(m[1])) && ours.has(Number(m[2]))) { ours.add(Number(m[1])); grew = true; } }
    const rows = all.filter((m) => !ours.has(Number(m[1]))).slice(0, 5).map((m) => [m[0], m[3], m[4]]);
    const busy = rows.find((m) => Number(m[1]) > 10 && !BASELINE.test(m[2]));
    if (!busy) return null;
    if (quietLeft <= 0) return `${busy[1]}% ${busy[2].slice(0, 60)}`;
    quietLeft -= 10000;
    await new Promise((r) => setTimeout(r, 10000));
  }
};
/**
 * **What each number describes** (2026-10-18): the tree, and a hash of every bundle and of the shipped Vera
 * dists it inlined, printed before anything runs, so a later reader can tell which source a record measured.
 */
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 12);
const root = new URL('../..', import.meta.url).pathname;
/** Every page's bundle must carry this stamp (`harness-sha.mjs`). */
const HARNESS = harnessSha();
console.log(`harness ${HARNESS} (main.js + impls.js; every bundle must carry it)`);
/** Held while this race times: builds, typecheck and lint refuse under it (`../race-lock.mjs`). */
holdRaceLock(root, 'bench/dom/race.mjs');
/** The race's wall time, printed at the end (the 5–10-minute test standard, 2026-11-08). */
const raceStart = Date.now();
/** Whether the screensaver is up (2026-11-07): `caffeinate` stops sleep, not the screensaver, so each session records it. */
const screensaver = () => { try { return execSync("pgrep -lx 'ScreenSaverEngine|legacyScreenSaver'").toString().trim().replace(/\n/g, ', ') || 'none'; } catch { return 'none'; } };
console.log(`tree ${execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim()}${execSync('git status --porcelain -- packages', { cwd: root }).toString().trim() ? ' (packages/ DIRTY)' : ''} at ${root}`);
/**
 * The harness's OWN source, hashed as it runs (2026-10-18): `tree` is HEAD, which says nothing about a working
 * tree that differs from it, so the header names the git blob race.mjs and main.js match, or says they're uncommitted.
 */
for (const file of ['bench/dom/race.mjs', 'bench/dom/main.js', 'bench/dom/impls.js']) {
  const blob = execSync(`git hash-object ${file}`, { cwd: root }).toString().trim();
  const head = execSync(`git rev-parse HEAD:${file}`, { cwd: root }).toString().trim();
  console.log(`  ${file} blob ${blob.slice(0, 12)}${blob === head ? ' (= HEAD)' : ' (UNCOMMITTED, differs from HEAD)'}`);
}
for (const [name, file, query] of variants) console.log(`  ${name}: ${join(directory, file)} sha ${sha(join(directory, file))}${query ? ` ?${query}` : ''}`);
for (const dist of ['core/dist/vera.min.js', 'renderer/dist/vera-renderer.min.js', 'renderer/dist/vera-renderer-slots.min.js', 'renderer/dist/vera-renderer-keyed.min.js'])
  console.log(`  ${dist} sha ${sha(join(root, 'packages', dist))}`);
/** Every competitor's version and the launch line (CLAUDE.md: print the mode and version; a field race is the one quoted). */
{
  const v = (pkg) => { try { return JSON.parse(readFileSync(join(root, 'bench/node_modules', pkg, 'package.json'), 'utf8')).version; } catch { return 'absent'; } };
  console.log(`  competitors: ${['solid-js', 'vue', 'svelte', 'vanjs-core', 'react', 'react-dom', 'preact', 'lit'].map((p) => `${p} ${v(p)}`).join(', ')}`);
  console.log('  launch: a FRESH browser per page — chrome = installed Chrome (channel: chrome) headed; firefox / webkit = Playwright builds headed (WebKit is not Safari)');
}
/** Batched ops are tens of µs per op: three decimals below 10 ms, or they all print as 0.1. */
const fmt = (m) => (m < 10 ? m.toFixed(3) : m.toFixed(1));
/** `--json=path` writes every session's medians and fastest runs, per engine, for a report to compute from. */
const json = flag('json');
const dump = {};
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const contended = [];
/**
 * **Thermal pressure is checked before EVERY page** (Brian, 2026-10-19 and 2026-10-25: cool only when pressure > 0, checked
 * per page): a fanless laptop throttles mid-session, so a check per session let throttled pages into the samples.
 */
const pressureNow = () => Number(execSync('notifyutil -g com.apple.system.thermalpressurelevel').toString().trim().split(/\s+/)[1]);
let cooledS = 0;
const cool = async () => { while (pressureNow() > 0) { console.log(`  thermal ${pressureNow()}: waiting 15 s`); cooledS += 15; await new Promise((r) => setTimeout(r, 15000)); } };

/**
 * update10's fixed N per ENGINE (2026-10-18): set in advance, the same for every implementation on that engine,
 * never derived from anyone's speed. WebKit runs update10 at ~0.1 ms/op, so 200 runs was a ~20 ms sample and one clock
 * tick was ~5%; 1000 makes it ~100 ms. Chrome and Firefox run it at ~5–6 ms/op with layout, already ~1 s at 200.
 */
const N10 = { chrome: 200, firefox: 200, webkit: 1000 };
/**
 * **Every race is bounded before it starts** (the 5–10-minute standard, 2026-11-08): each page carries a wall limit
 * (`&pagems`, default 15 s, enforced in the page), so a race is at most pages × (limit + launch). That bound is printed
 * BEFORE the first page, and a race projected over 10 minutes refuses to start unless `--long` (a checkpoint) is given.
 */
const PAGE_MS = Number(new URLSearchParams(variants[0]?.[2] ?? '').get('pagems')) || 15000;
/** The page count includes each engine's calibration page (`calibrate` below). */
const pageCount = engines.length + engines.length * sessions * variants.reduce((n, v) => n + impls.filter((i) => !subset[v[0]] || subset[v[0]].includes(i)).length, 0);
const boundMin = (pageCount * (PAGE_MS + 3000) + QUIET_BUDGET_MS) / 60000;
console.log(`bound: ${pageCount} pages × ≤${(PAGE_MS + 3000) / 1000} s + ≤${QUIET_BUDGET_MS / 1000} s quiet waits = ≤${boundMin.toFixed(1)} min`);
if (boundMin > 10 && !args.includes('--long')) throw new Error(`projected ≤${boundMin.toFixed(1)} min is over 10: narrow the race (rows, arms, sessions, impls) or pass --long for a checkpoint`);
/** HEADED, all three (CLAUDE.md, Brian 2026-10-18): bare firefox/webkit.launch() is headless, whose frames are not tied to a compositor. */
/**
 * A page's browser is KILLED at the end, never closed (2026-11-08): headed Chrome's graceful `close()` took 9.0 s even on
 * a blank page, a third of every Chrome page, while `kill()` ends it in ~30 ms with its whole process tree gone at once
 * (measured on all three engines: 0 of 7 / 6 / 2 processes left at 0 ms), and the temporary profile is still removed.
 */
const launch = async (engine) => {
  const [type, options] = engine === 'chrome' ? [chromium, { channel: 'chrome' }] : [engine === 'firefox' ? firefox : webkit, {}];
  const prefs = COI && engine === 'firefox' ? { firefoxUserPrefs: { 'privacy.reduceTimerPrecision': false, 'privacy.reduceTimerPrecision.unconditional': false } } : {};
  const server = await type.launchServer({ ...options, ...prefs, headless: false });
  return { browser: await type.connect(server.wsEndpoint()), end: () => server.kill() };
};
/**
 * One page, start to finish: a fresh browser, the variant's bundle, the run, and every check a page must pass before its
 * numbers are read (its own error or wall limit, the harness stamp, row errors, `verify`). Returns the open page.
 */
const runPage = async (engine, label, file, impl, query) => {
  const t0 = Date.now();
  const { browser, end } = await launch(engine);
  const page = await browser.newPage();
  const launched = Date.now();
  await page.route('**/bundle.js', (route) => route.fulfill({ body: readFileSync(join(directory, file)), contentType: 'text/javascript', headers: ISOLATION }));
  await page.goto(`http://localhost:8098/?only=${encodeURIComponent(impl)}${ops ? `&ops=${ops}` : ''}${query ? `&${query}` : ''}&n10=${N10[engine]}`);
  await page.waitForFunction(() => document.getElementById('status')?.textContent === 'Ready.', null, { timeout: 60000 });
  const loaded = Date.now();
  await page.click('#run');
  await page.waitForFunction(() => window.__RESULTS__ !== undefined || window.__PAGE_ERROR__ !== undefined, null, { timeout: PAGE_MS + 30000 });
  /** Where a page's time goes (launch, load to Ready, the run), for sizing races; closing is timed by the caller. */
  page.phases = [launched - t0, loaded - launched, Date.now() - loaded];
  const pageError = await page.evaluate(() => window.__PAGE_ERROR__);
  if (pageError !== undefined) throw new Error(`${label}: ${pageError}`);
  const timer = await page.evaluate(() => window.__TIMER__);
  if (!timerSeen[engine]) { timerSeen[engine] = true; console.log(`${engine}: crossOriginIsolated ${timer?.isolated}, observed timer tick ${timer?.tickUs} µs`); }
  if (COI && timer?.isolated !== true) throw new Error(`${label}: --coi, but the page is not cross-origin isolated`);
  const stamp = await page.evaluate(() => window.__HARNESS__);
  if (stamp !== HARNESS) throw new Error(`${label}: ${file} was built from harness ${stamp}, the files on disk are ${HARNESS}: rebuild it`);
  const rowErrors = await page.evaluate(() => window.__ROW_ERRORS__);
  if (rowErrors) throw new Error(`${label}: ${rowErrors.join('; ')}`);
  /** `&verify=1`: every batched run must have changed the DOM (noop excepted), or the sample timed less than its op. */
  if (/(^|&)verify=/.test(query)) {
    const unchanged = await page.evaluate(() => window.__UNCHANGED__);
    if (unchanged === undefined) throw new Error(`${label}: verify ran but the page reported nothing`);
    const bad = Object.entries(unchanged).filter(([op]) => op !== 'noop');
    if (bad.length) throw new Error(`${label}: runs that left the DOM unchanged: ${bad.map(([op, n]) => `${op} ${n}`).join(', ')}`);
    console.log(`${label}: verify clean`);
  }
  return { page, end };
};
/**
 * **Counts calibrated once per engine, on the base arm** (`&minms`, 2026-11-08): one warm-ups-only page sizes every row's
 * runs per sample, and every page of every arm on that engine runs those counts, so no arm's own speed sets its N.
 */
const counts = {};
/** Each engine's isolation and timer tick, printed from its first page. */
const timerSeen = {};
const calibrate = async (engine) => {
  const [name, file, query] = variants[0];
  if (!/(^|&)minms=/.test(query)) return;
  const { page, end } = await runPage(engine, `${engine} calibration (${name})`, file, impls[0], `${query}&calibrate`);
  const sized = await page.evaluate(() => window.__COUNTS__);
  await end();
  if (!sized || !Object.keys(sized).length) throw new Error(`${engine} calibration: the page sized no counts`);
  counts[engine] = Object.entries(sized).map(([op, n]) => `${op}:${n}`).join(',');
  console.log(`${engine}: counts per sample, calibrated on ${name} / ${impls[0]}: ${counts[engine]}`);
};
const plantSeen = {};
for (const engine of engines) {
  console.log(`${engine}: update10 fixed N = ${N10[engine]}`);
  await calibrate(engine);
  const data = {};
  /** Each session's fastest run, kept for the reference column (the typical case, `data`, is the claim). */
  const fastest = {};
  const runs = {};
  const elapsed = {};
  /** Each row's wall time per page (`__ROW_MS__`), for sizing a race's rows. */
  const rowWall = {};
  /** Per page: [launch, load, run, close] ms. */
  const phases = {};
  for (let session = 0; session < sessions; session++) {
    const busy = await quiet();
    if (busy) contended.push(`${engine}/${session}: ${busy}`);
    /** The conditions, ignored daemons INCLUDED (2026-10-18): the A/A is the defense; this line says whether it was needed. */
    const top = execSync('ps -Ao pcpu,comm -r').toString().trim().split('\n').slice(1, 4).map((l) => { const m = l.trim().match(/^([\d.]+)\s+(.*)$/); return `${m[1]} ${m[2].split('/').pop()}`; }).join(', ');
    const pressure = execSync('notifyutil -g com.apple.system.thermalpressurelevel').toString().trim().split(/\s+/)[1];
    console.log(`${engine}/${session}: thermal ${pressure} | ${top} | screensaver ${screensaver()}`);
    for (const [[name, file, query], impl] of shuffle(variants.flatMap((v) => impls.filter((i) => !subset[v[0]] || subset[v[0]].includes(i)).map((i) => [v, i])), session)) {
      await cool();
      const pageStart = Date.now();
      const { page, end } = await runPage(engine, `${engine}/${session} ${name} ${impl}`, file, impl, `${query}${counts[engine] ? `&counts=${counts[engine]}` : ''}`);
      const results = await page.evaluate(() => window.__RESULTS__);
      const rowMs = await page.evaluate(() => window.__ROW_MS__);
      for (const [op, ms] of Object.entries(rowMs ?? {})) ((((rowWall[impl] ??= {})[op] ??= {})[name] ??= []).push(ms));
      /** The positive control's real size on this engine (`&plant`), printed once per engine and variant. */
      const plantUs = await page.evaluate(() => window.__PLANT_US__);
      if (plantUs !== undefined && !(plantSeen[`${engine}/${name}`])) { plantSeen[`${engine}/${name}`] = true; console.log(`${engine}/${name}: the planted work costs ${plantUs.toFixed(1)} µs per run on this engine`); }
      /** A page whose build has no such implementation ran nothing for it (2026-10-23: `VeraJS auto` exists only where core
       *  has `lists`): skipped, so one race can pair a build's implementation with another build's. */
      if (!Object.values(results).some((byImpl) => byImpl && impl in byImpl)) { await end(); continue; }
      /** The page must prove the wiring the variant names, or the variants all measure one program (2026-10-18: they did). */
      const wiring = await page.evaluate(() => window.__VERA_WIRING__);
      const mode = new URLSearchParams(query).get('vera');
      const expected = mode === 'slots' ? 'slots+slots' : mode === null ? 'legacy' : mode;
      /** Only a Vera page wires Vera; a competitor's page has nothing to prove. */
      if (impl.startsWith('VeraJS') && wiring !== expected) throw new Error(`${engine}/${session} ${name}: the page wired ${wiring}, the variant asks for ${expected}`);
      const closeStart = Date.now();
      await end();
      /** Every run and each page's elapsed time, for `--json`: a median of a page's repeats can skip a collection, and one landing between repeats is in no run at all (2026-10-31). */
      ((elapsed[impl] ??= {})[name] ??= []).push(Date.now() - pageStart);
      ((phases[impl] ??= {})[name] ??= []).push([...page.phases, Date.now() - closeStart]);
      for (const [op, byImpl] of Object.entries(results))
        for (const [i, r] of Object.entries(byImpl)) ((runs[i] ??= {})[op] ??= {})[name] = [...(runs[i]?.[op]?.[name] ?? []), r?.timings ?? []];
      for (const [op, byImpl] of Object.entries(results))
        for (const [impl, r] of Object.entries(byImpl)) {
          ((data[impl] ??= {})[op] ??= {})[name] = [...(data[impl][op][name] ?? []), r?.median ?? NaN];
          ((fastest[impl] ??= {})[op] ??= {})[name] = [...(fastest[impl][op][name] ?? []), r?.min ?? NaN];
        }
    }
    /** Written after EVERY session (2026-10-25): a crash or an alarm costs one session, never an engine (one crash once cost a whole engine its 7 sessions). */
    dump[engine] = { data, fastest, runs, elapsed, rowWall, phases, sessions: session + 1 };
    if (json) writeFileSync(json, JSON.stringify(dump));
  }
  dump[engine] = { data, fastest, runs, elapsed, rowWall, phases };
  if (json) writeFileSync(json, JSON.stringify(dump));
  const base = variants[0][0];
  if (variants.length === 1 || Object.keys(data).length > 1) {
    /** The base build: compare the IMPLEMENTATIONS — median of session medians, and sessions each was fastest in. */
    const impls = Object.keys(data);
    console.log(`\n== ${engine}: ms per op (${/layout=1/.test(variants[0][2]) ? 'script + DOM + layout, paint excluded; +paint rows to paint' : 'to paint'}), median of ${sessions} session medians (sessions fastest)`);
    console.log('  ' + 'operation'.padEnd(15) + impls.map((n) => n.padStart(Math.max(17, n.length + 2))).join(''));
    for (const op of Object.keys(data[impls[0]])) {
      const meds = impls.map((n) => med(data[n][op][base]));
      const wins = impls.map((n) => data[n][op][base].filter((x, s) => impls.every((m) => data[m][op][base][s] >= x)).length);
      console.log('  ' + op.padEnd(15) + meds.map((m, j) => `${fmt(m)} (${wins[j]})`.padStart(Math.max(17, impls[j].length + 2))).join(''));
    }
    if (variants.length === 1) continue;
  }
  for (const [impl, byOp] of Object.entries(data)) {
    console.log(`\n== ${engine} / ${impl}: ms to paint, median of ${sessions} session medians; Δ vs ${base} (sessions faster)`);
    for (const [op, byVariant] of Object.entries(byOp)) {
      /** A variant whose build lacks this implementation has no data (skipped above): reported as absent, never as NaN. */
      if (!byVariant[base]) { console.log(`  ${op.padEnd(10)} ${base} absent — ${Object.keys(byVariant).map((n) => `${n} ${med(byVariant[n]).toFixed(2)}`).join('  ')}`); continue; }
      const b = med(byVariant[base]);
      let line = `  ${op.padEnd(10)} ${base} ${b.toFixed(2).padStart(7)}`;
      for (const [name] of variants.slice(1)) {
        if (!byVariant[name]) { line += `  ${name} absent`; continue; }
        const m = med(byVariant[name]);
        const wins = byVariant[name].filter((x, i) => x < byVariant[base][i]).length;
        line += `  ${name} ${(((m - b) / b) * 100).toFixed(1).padStart(6)}% (${wins}/${sessions})`;
      }
      /**
       * **A two-mode row is read by its slow-mode FREQUENCY, not its median** (2026-10-24; CLAUDE.md, "a metric with
       * two modes"): Firefox lands each fresh instance in one of a few speed modes for some rows, so a session median
       * picks a mode and the A/A splits. When any variant's sessions spread more than 20%, each variant's count of
       * sessions in the SLOW mode is shown beside its median. ONE boundary for every variant, from the POOLED sessions
       * (per-variant boundaries make the counts incomparable), anchored on the median of the faster half (robust; a
       * minimum moves with one lucky session): 1.15× it (the review, pre-registered).
       */
      const all = Object.values(byVariant).flat().filter(Number.isFinite).sort((a, b) => a - b);
      const spread = Math.max(...Object.values(byVariant).map((xs) => (Math.max(...xs) - Math.min(...xs)) / med(xs)));
      if (spread > 0.2 && !op.startsWith('noop')) {
        const slow = 1.15 * med(all.slice(0, Math.max(1, all.length >> 1)));
        line += `   [two-mode: slow ${Object.entries(byVariant).map(([n, xs]) => `${n} ${xs.filter((x) => x > slow).length}/${xs.length}`).join(', ')}]`;
      }
      console.log(line);
    }
  }
}
console.log(`cooled ${cooledS} s (thermal waits before pages)`);
console.log(`screensaver at the end: ${screensaver()}`);
console.log(`wall ${((Date.now() - raceStart) / 60000).toFixed(1)} min`);
console.log(contended.length ? `\ncontended: ${contended.join('; ')}` : '\nquiet: every session started below 10% of a core');
server.close();
