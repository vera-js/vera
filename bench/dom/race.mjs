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
const server = createServer((request, response) => {
  const url = decodeURIComponent(request.url.split('?')[0]);
  const path = join(directory, url === '/' ? 'index.html' : url);
  if (!existsSync(path)) return response.writeHead(404), response.end();
  response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
  response.end(readFileSync(path));
});
await new Promise((resolve) => server.listen(8098, resolve));

/** OS daemons are ignored, never waited on (Brian, 2026-10-18): media/photo analysis and Spotlight run when they like. */
const BASELINE = /claude|Code Helper|WindowServer|\/ps$|Google Chrome|firefox|Firefox|WebKit|Playwright|node|mediaanalysisd|photoanalysisd|mds|mdworker|mds_stores|corespotlightd|spotlightknowledged|fseventsd|ospredictiond|ecosystemd|EcosystemAnalytics/;
const quiet = async () => {
  for (let tries = 0; tries < 12; tries++) {
    const rows = execSync('ps -Ao pcpu,comm -r').toString().trim().split('\n').slice(1, 6).map((l) => l.trim().match(/^([\d.]+)\s+(.*)$/)).filter(Boolean);
    const busy = rows.find((m) => Number(m[1]) > 10 && !BASELINE.test(m[2]));
    if (!busy) return null;
    if (tries === 11) return `${busy[1]}% ${busy[2].slice(0, 60)}`;
    await new Promise((r) => setTimeout(r, 10000));
  }
};
/**
 * **What each number describes** (2026-10-18): the tree, and a hash of every bundle and of the shipped Vera
 * dists it inlined, printed before anything runs, so a later reader can tell which source a record measured.
 */
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 12);
const root = new URL('../..', import.meta.url).pathname;
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
/** HEADED, all three (CLAUDE.md, Brian 2026-10-18): bare firefox/webkit.launch() is headless, whose frames are not tied to a compositor. */
const plantSeen = {};
const launch = (engine) => engine === 'chrome' ? chromium.launch({ channel: 'chrome', headless: false }) : engine === 'firefox' ? firefox.launch({ headless: false }) : webkit.launch({ headless: false });
for (const engine of engines) {
  console.log(`${engine}: update10 fixed N = ${N10[engine]}`);
  const data = {};
  /** Each session's fastest run, kept for the reference column (the typical case, `data`, is the claim). */
  const fastest = {};
  for (let session = 0; session < sessions; session++) {
    const busy = await quiet();
    if (busy) contended.push(`${engine}/${session}: ${busy}`);
    /** The conditions, ignored daemons INCLUDED (2026-10-18): the A/A is the defense; this line says whether it was needed. */
    const top = execSync('ps -Ao pcpu,comm -r').toString().trim().split('\n').slice(1, 4).map((l) => { const m = l.trim().match(/^([\d.]+)\s+(.*)$/); return `${m[1]} ${m[2].split('/').pop()}`; }).join(', ');
    const pressure = execSync('notifyutil -g com.apple.system.thermalpressurelevel').toString().trim().split(/\s+/)[1];
    console.log(`${engine}/${session}: thermal ${pressure} | ${top}`);
    for (const [[name, file, query], impl] of shuffle(variants.flatMap((v) => impls.filter((i) => !subset[v[0]] || subset[v[0]].includes(i)).map((i) => [v, i])), session)) {
      await cool();
      const browser = await launch(engine);
      const page = await browser.newPage();
      await page.route('**/bundle.js', (route) => route.fulfill({ body: readFileSync(join(directory, file)), contentType: 'text/javascript' }));
      await page.goto(`http://localhost:8098/?only=${encodeURIComponent(impl)}${ops ? `&ops=${ops}` : ''}${query ? `&${query}` : ''}&n10=${N10[engine]}`);
      await page.waitForFunction(() => document.getElementById('status')?.textContent === 'Ready.', null, { timeout: 60000 });
      await page.click('#run');
      await page.waitForFunction(() => window.__RESULTS__ !== undefined, null, { timeout: 900000 });
      const results = await page.evaluate(() => window.__RESULTS__);
      /** The positive control's real size on this engine (`&plant`), printed once per engine and variant. */
      const plantUs = await page.evaluate(() => window.__PLANT_US__);
      if (plantUs !== undefined && !(plantSeen[`${engine}/${name}`])) { plantSeen[`${engine}/${name}`] = true; console.log(`${engine}/${name}: the planted work costs ${plantUs.toFixed(1)} µs per run on this engine`); }
      /** A page whose build has no such implementation ran nothing for it (2026-10-23: `VeraJS auto` exists only where core
       *  has `lists`): skipped, so one race can pair a build's implementation with another build's. */
      if (!Object.values(results).some((byImpl) => byImpl && impl in byImpl)) { await browser.close(); continue; }
      /** The page must prove the wiring the variant names, or the variants all measure one program (2026-10-18: they did). */
      const wiring = await page.evaluate(() => window.__VERA_WIRING__);
      const mode = new URLSearchParams(query).get('vera');
      const expected = mode === 'slots' ? 'slots+slots' : mode === null ? 'legacy' : mode;
      /** Only a Vera page wires Vera; a competitor's page has nothing to prove. */
      if (impl.startsWith('VeraJS') && wiring !== expected) throw new Error(`${engine}/${session} ${name}: the page wired ${wiring}, the variant asks for ${expected}`);
      await browser.close();
      for (const [op, byImpl] of Object.entries(results))
        for (const [impl, r] of Object.entries(byImpl)) {
          ((data[impl] ??= {})[op] ??= {})[name] = [...(data[impl][op][name] ?? []), r?.median ?? NaN];
          ((fastest[impl] ??= {})[op] ??= {})[name] = [...(fastest[impl][op][name] ?? []), r?.min ?? NaN];
        }
    }
    /** Written after EVERY session (2026-10-25, vera-5a): a crash or an alarm costs one session, never an engine (B4 lost 7). */
    dump[engine] = { data, fastest, sessions: session + 1 };
    if (json) writeFileSync(json, JSON.stringify(dump));
  }
  dump[engine] = { data, fastest };
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
       * **A two-mode row is read by its slow-mode FREQUENCY, not its median** (2026-10-24, L6; CLAUDE.md, "a metric with
       * two modes"): Firefox lands each fresh instance in one of a few speed modes for some rows, so a session median
       * picks a mode and the A/A splits. When any variant's sessions spread more than 20%, each variant's count of
       * sessions in the SLOW mode is shown beside its median. ONE boundary for every variant, from the POOLED sessions
       * (per-variant boundaries make the counts incomparable), anchored on the median of the faster half (robust; a
       * minimum moves with one lucky session): 1.15× it (vera-5a's review, pre-registered).
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
console.log(contended.length ? `\ncontended: ${contended.join('; ')}` : '\nquiet: every session started below 10% of a core');
server.close();
