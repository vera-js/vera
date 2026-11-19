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
import { execSync, exec, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { holdRaceLock } from '../race-lock.mjs';
import { harnessSha } from './harness-sha.mjs';
import { parsePs, treeOf, outside, foreignBrowsers, busyApps, assess, saverUp, displayHeldFor, startVerdict } from './guards.mjs';

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

/**
 * **What counts as load, and as a foreign browser, is decided in `guards.mjs`** (pure functions over `ps` snapshots, driven
 * by `tests/race-guards.test.mjs`; the policy Brian approved 2026-11-17): our own tree and every browser we launched are
 * never load; OS daemons, by binary path, are logged and never waited on; an app is load when sustained over 10% of a
 * core; the machine is saturated past one full core, sustained. Here: running `ps`, and acting on the answers.
 */
/** The whole race's quiet-machine waiting, bounded (2026-11-08): it is in the projected wall time, and a session that
 *  starts once it is spent is marked contended (the A/A arm is the defense) rather than waited for. */
const QUIET_BUDGET_MS = 90000;
let quietLeft = QUIET_BUDGET_MS;
const PS = 'ps -Ao pid=,ppid=,pcpu=,comm= -r';
/**
 * **Every browser process this race ever launched, by PID, kept after it is killed** (2026-11-17):
 * filled at each page's end from a snapshot taken just before the kill; `guards.mjs`'s `outside` says when it can fire.
 */
const launchedPids = new Set();
const TEST_DYING = process.argv.includes('--test-dying-browser');
if (TEST_DYING) console.log('TEST SWITCH --test-dying-browser: kills are not awaited; this run tests the harness, its numbers are not a race');
let ownLeftoversExcluded = 0;
/** One snapshot's processes outside this race; the own-leftover exclusion is counted, and logged the first time it fires. */
const othersIn = (rows) => {
  const { others, ownLeftovers } = outside(rows, process.pid, launchedPids);
  if (ownLeftovers.length && ++ownLeftoversExcluded === 1)
    console.log(`  own killed browser still exiting, excluded by PID: ${ownLeftovers.slice(0, 3).map(([pid, , , comm]) => `${comm.split('/').pop()} (PID ${pid})`).join(', ')}`);
  return others;
};
const othersNow = () => othersIn(parsePs(execSync(PS)));
/**
 * **Load DURING a page** (2026-11-17): a pre-page sample cannot see a burst that starts inside the page,
 * which is how the dictation app's load arrived. One asynchronous `ps` a second while the page runs, plus one after it;
 * `stop()` answers `guards.mjs`'s `assess` over them. Every arm pays the same sampler, so the A/A arm carries its cost.
 */
const startSampler = () => {
  const snapshots = [];
  let pending = Promise.resolve();
  const sample = () => (pending = new Promise((resolve) => exec(PS, (error, out) => {
    if (!error) snapshots.push(othersIn(parsePs(out)));
    resolve();
  })));
  const timer = setInterval(sample, 1000);
  return { stop: async () => { clearInterval(timer); await pending; await sample(); return assess(snapshots); } };
};
/**
 * **A browser this race did not launch refuses the race** (Brian approved, 2026-11-17): the user's own installed Chrome,
 * left running, plus a dictation app made a row two-mode per page while every start-of-session CPU sample read quiet.
 */
const refuseForeignBrowser = () => {
  const found = foreignBrowsers(othersNow());
  if (found.length) throw new Error(`another browser is running outside this race: ${found.join(', ')}. Quit it and start again.`);
};
/** Waits, within the race's budget, until no app outside the race holds over 10% of a core; answers the last busy one once the budget is spent. */
const quiet = async () => {
  for (;;) {
    const busy = busyApps(othersNow())[0];
    if (!busy) return null;
    if (quietLeft <= 0) return `${busy[1]}% ${busy[2].slice(0, 60)}`;
    console.log(`  waiting for a quiet machine: ${busy[1]}% ${busy[2].split('/').pop()} (${quietLeft / 1000} s of the budget left)`);
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
/** The screen saver's state now (`guards.mjs`'s `saverUp`): its processes, and the Aerials extension's CPU. */
const saverNow = () => {
  let processes = [];
  try { processes = execSync("pgrep -lx 'ScreenSaverEngine|legacyScreenSaver'").toString().trim().split('\n').filter(Boolean); } catch {}
  return saverUp(processes, parsePs(execSync(PS)));
};
const screensaver = () => saverNow().join(', ') || 'none';
/**
 * **A screen saver up, or due, refuses the race at its start; caffeinate held from then on keeps one from coming up**
 * (`guards.mjs`'s `startVerdict` decides; Brian allows caffeinate for every race, 2026-11-17). Here: the inputs — the
 * saver's processes, the idle time, its threshold, the display assertions — and the race's own `caffeinate -dimsu`, tied
 * to this process. Never touch the screen-saver setting itself.
 */
{
  let threshold = 0;
  try { threshold = Number(execSync('defaults -currentHost read com.apple.screensaver idleTime', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()) || 0; } catch {}
  const verdict = startVerdict({
    saver: saverNow(),
    idle: Number(/"HIDIdleTime" = (\d+)/.exec(execSync('ioreg -c IOHIDSystem').toString())?.[1] ?? 0) / 1e9,
    threshold,
    held: displayHeldFor(execSync('pmset -g assertions').toString()),
  });
  if (!verdict.start) throw new Error(`${verdict.reason}: one mouse move dismisses it; then start the race again`);
  console.log(`${verdict.reason}; caffeinate held for the race`);
}
spawn('caffeinate', ['-dimsu', '-w', String(process.pid)], { stdio: 'ignore' }).unref();
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
/** Re-runs of a contended page, and the sessions that stayed contended (see the page loop). */
const RETRIES = 2;
const voidSessions = [];
/**
 * **Thermal pressure is checked before EVERY page** (Brian, 2026-10-19 and 2026-10-25: cool only when pressure > 0, checked
 * per page): a fanless laptop throttles mid-session, so a check per session let throttled pages into the samples.
 */
const pressureNow = () => Number(execSync('notifyutil -g com.apple.system.thermalpressurelevel').toString().trim().split(/\s+/)[1]);
let cooledS = 0;
/** Above 0, pause a MINUTE at a time until it clears (Brian, 2026-11-18). */
const cool = async () => { while (pressureNow() > 0) { console.log(`  thermal ${pressureNow()}: pausing 60 s`); cooledS += 60; await new Promise((r) => setTimeout(r, 60000)); } };

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
  const root = server.process().pid;
  launchedPids.add(root);
  /** `--test-dying-browser` (a harness TEST switch, never for a timed race): the kill is not awaited, so the next page's
   *  foreign-browser and CPU checks run while this browser is still exiting — the own-leftover exclusion must fire. */
  return { browser: await type.connect(server.wsEndpoint()), end: () => { for (const pid of treeOf(parsePs(execSync(PS)), [root])) launchedPids.add(pid); const killing = server.kill(); return TEST_DYING ? undefined : killing; } };
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
  if (!timerSeen[engine]) { timerSeen[engine] = true; console.log(`${engine}: browser ${browser.version()} | crossOriginIsolated ${timer?.isolated}, observed timer tick ${timer?.tickUs} µs`); }
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
refuseForeignBrowser();
/**
 * **A 2-minute pause before the batch starts** (Brian, 2026-11-18: before starting the next heavy batch, not between its
 * runs): the previous batch's heat is not this one's; then the thermal gate, a minute at a time until it clears.
 * `BATCH_PAUSE_S` overrides the default (0 for a harness self-test only).
 */
const BATCH_PAUSE_S = Number(process.env.BATCH_PAUSE_S ?? 120);
if (BATCH_PAUSE_S > 0) { console.log(`batch pause: ${BATCH_PAUSE_S} s before the first page`); await new Promise((r) => setTimeout(r, BATCH_PAUSE_S * 1000)); }
await cool();
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
  /** Per page, the OS daemon bursts logged (`guards.mjs`): kept in the JSON so a two-mode reading can be checked against them. */
  const daemons = {};
  for (let session = 0; session < sessions; session++) {
    const busy = await quiet();
    if (busy) contended.push(`${engine}/${session}: ${busy}`);
    /** The conditions, ignored daemons INCLUDED (2026-10-18): the A/A is the defense; this line says whether it was needed. */
    const top = execSync('ps -Ao pcpu,comm -r').toString().trim().split('\n').slice(1, 4).map((l) => { const m = l.trim().match(/^([\d.]+)\s+(.*)$/); return `${m[1]} ${m[2].split('/').pop()}`; }).join(', ');
    const pressure = execSync('notifyutil -g com.apple.system.thermalpressurelevel').toString().trim().split(/\s+/)[1];
    console.log(`${engine}/${session}: thermal ${pressure} | ${top} | screensaver ${screensaver()}`);
    /**
     * **A contended page is re-run, and a session that stays contended is VOID** (pre-registered; Brian
     * approved the guards, 2026-11-17): a page with a foreign process over 10% of a core before it (once the wait budget
     * is spent), during it or after it is discarded and queued again at the end of its session, up to RETRIES times; its
     * last try is recorded and listed as contended. A session with more than one such page is VOID, and the race exits 3.
     * One recorded page per arm per session either way, so the per-session columns stay aligned.
     */
    const queue = shuffle(variants.flatMap((v) => impls.filter((i) => !subset[v[0]] || subset[v[0]].includes(i)).map((i) => [v, i])), session).map((entry) => [entry, 0]);
    let contendedHere = 0;
    while (queue.length) {
      const [[[name, file, query], impl], tries] = queue.shift();
      await cool();
      /** **Before EVERY page, not only each session** (Brian approved, 2026-11-17): bursty load between a session's start
       *  and its later pages was invisible to a once-per-session sample. Same bounded budget; a page that starts once
       *  it is spent is listed as contended. */
      refuseForeignBrowser();
      const pageBusy = await quiet();
      const pageStart = Date.now();
      const sampler = startSampler();
      const { page, end } = await runPage(engine, `${engine}/${session} ${name} ${impl}`, file, impl, `${query}${counts[engine] ? `&counts=${counts[engine]}` : ''}`);
      const results = await page.evaluate(() => window.__RESULTS__);
      const { contended: busyDuring, daemonBursts } = await sampler.stop();
      /** OS daemon bursts are LOGGED per page, never a verdict: a later two-mode reading can be checked against them. */
      if (daemonBursts.length) {
        console.log(`  ${engine}/${session} ${name} ${impl}: daemon bursts (logged, not voiding): ${[...new Set(daemonBursts)].join(', ')}`);
        (((daemons[impl] ??= {})[name] ??= [])).push(daemonBursts);
      }
      const busyHere = pageBusy ?? busyDuring;
      if (busyHere && tries < RETRIES) {
        await end();
        console.log(`  ${engine}/${session} ${name} ${impl}: contended (${pageBusy ? 'before' : 'during'}: ${busyHere}); re-run at the end of the session (${tries + 1}/${RETRIES})`);
        queue.push([[[name, file, query], impl], tries + 1]);
        continue;
      }
      if (busyHere) { contendedHere++; contended.push(`${engine}/${session} ${name} ${impl}: ${busyHere} (after ${RETRIES} re-runs)`); }
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
    if (contendedHere > 1) { voidSessions.push(`${engine}/${session} (${contendedHere} contended pages)`); console.log(`  ${engine}/${session}: VOID, ${contendedHere} pages contended after their re-runs`); }
    /** Written after EVERY session (2026-10-25): a crash or an alarm costs one session, never an engine (one crash once cost a whole engine its 7 sessions). */
    dump[engine] = { data, fastest, runs, elapsed, rowWall, phases, daemons, sessions: session + 1 };
    if (json) writeFileSync(json, JSON.stringify(dump));
  }
  dump[engine] = { data, fastest, runs, elapsed, rowWall, phases, daemons };
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
console.log(contended.length ? `\ncontended: ${contended.join('; ')}` : '\nquiet: every RECORDED page ran with no app sustained over 10% of a core and the machine under one full core (before, during and after); pages re-run for load, and OS daemon bursts, are logged above');
console.log(`own killed browsers excluded by PID: ${ownLeftoversExcluded} check(s)`);
if (voidSessions.length) { console.log(`VOID: ${voidSessions.join('; ')}`); process.exitCode = 3; }
server.close();
