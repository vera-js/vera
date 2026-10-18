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
 * (`slots=bundle.js?vera=slots`), so one bundle can be raced wired two ways. **Every page gets a fresh browser**
 * (2026-10-18): same-site pages in one Firefox share a content process, so a page's garbage was collected inside the
 * next page's timed window and results followed the rotation, not the code.
 */
import { chromium, firefox, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const sessions = Number(args[0]);
const variants = args.slice(1).filter((a) => !a.startsWith('--')).map((a) => { const [name, spec] = a.split('='); const [file, query = ''] = spec.split('?'); return [name, file, query]; });
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const only = flag('only') ?? 'VeraJS own,VeraJS default';
const ops = flag('ops');
const engines = (flag('engines') ?? 'chrome,firefox,webkit').split(',');
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
const BASELINE = /claude|Code Helper|WindowServer|\/ps$|Google Chrome|firefox|Firefox|WebKit|Playwright|node|mediaanalysisd|photoanalysisd|mds|mdworker|mds_stores|corespotlightd|spotlightknowledged|fseventsd|ospredictiond/;
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
 * **What each number describes** (vera-5a, 2026-10-18): the tree, and a hash of every bundle and of the shipped Vera
 * dists it inlined, printed before anything runs, so a later reader can tell which source a record measured.
 */
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 12);
const root = new URL('../..', import.meta.url).pathname;
console.log(`tree ${execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim()}${execSync('git status --porcelain -- packages', { cwd: root }).toString().trim() ? ' (packages/ DIRTY)' : ''} at ${root}`);
for (const [name, file, query] of variants) console.log(`  ${name}: ${join(directory, file)} sha ${sha(join(directory, file))}${query ? ` ?${query}` : ''}`);
for (const dist of ['core/dist/vera.min.js', 'renderer/dist/vera-renderer.min.js', 'renderer/dist/vera-renderer-slots.min.js', 'renderer/dist/vera-renderer-keyed.min.js'])
  console.log(`  ${dist} sha ${sha(join(root, 'packages', dist))}`);
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const contended = [];

const launch = (engine) => engine === 'chrome' ? chromium.launch({ channel: 'chrome', headless: false }) : engine === 'firefox' ? firefox.launch() : webkit.launch();
for (const engine of engines) {
  const data = {};
  for (let session = 0; session < sessions; session++) {
    const busy = await quiet();
    if (busy) contended.push(`${engine}/${session}: ${busy}`);
    /** The conditions, ignored daemons INCLUDED (vera-5a, 2026-10-18): the A/A is the defense; this line says whether it was needed. */
    const top = execSync('ps -Ao pcpu,comm -r').toString().trim().split('\n').slice(1, 4).map((l) => { const m = l.trim().match(/^([\d.]+)\s+(.*)$/); return `${m[1]} ${m[2].split('/').pop()}`; }).join(', ');
    const pressure = execSync('notifyutil -g com.apple.system.thermalpressurelevel').toString().trim().split(/\s+/)[1];
    console.log(`${engine}/${session}: thermal ${pressure} | ${top}`);
    for (const [name, file, query] of variants.map((_, i) => variants[(i + session) % variants.length])) {
      const browser = await launch(engine);
      const page = await browser.newPage();
      await page.route('**/bundle.js', (route) => route.fulfill({ body: readFileSync(join(directory, file)), contentType: 'text/javascript' }));
      await page.goto(`http://localhost:8098/?only=${encodeURIComponent(only)}${ops ? `&ops=${ops}` : ''}${query ? `&${query}` : ''}`);
      await page.waitForFunction(() => document.getElementById('status')?.textContent === 'Ready.', null, { timeout: 60000 });
      await page.click('#run');
      await page.waitForFunction(() => window.__RESULTS__ !== undefined, null, { timeout: 900000 });
      const results = await page.evaluate(() => window.__RESULTS__);
      await browser.close();
      for (const [op, byImpl] of Object.entries(results))
        for (const [impl, r] of Object.entries(byImpl)) ((data[impl] ??= {})[op] ??= {})[name] = [...(data[impl][op][name] ?? []), r?.median ?? NaN];
    }
  }
  const base = variants[0][0];
  if (variants.length === 1) {
    /** One build: compare the IMPLEMENTATIONS — median of session medians, and sessions each was fastest in. */
    const impls = Object.keys(data);
    console.log(`\n== ${engine}: ms to paint, median of ${sessions} session medians (sessions fastest)`);
    console.log('  ' + 'operation'.padEnd(10) + impls.map((n) => n.slice(0, 14).padStart(17)).join(''));
    for (const op of Object.keys(data[impls[0]])) {
      const meds = impls.map((n) => med(data[n][op][base]));
      const wins = impls.map((n) => data[n][op][base].filter((x, s) => impls.every((m) => data[m][op][base][s] >= x)).length);
      console.log('  ' + op.padEnd(10) + meds.map((m, j) => `${m.toFixed(1)} (${wins[j]})`.padStart(17)).join(''));
    }
    continue;
  }
  for (const [impl, byOp] of Object.entries(data)) {
    console.log(`\n== ${engine} / ${impl}: ms to paint, median of ${sessions} session medians; Δ vs ${base} (sessions faster)`);
    for (const [op, byVariant] of Object.entries(byOp)) {
      const b = med(byVariant[base]);
      let line = `  ${op.padEnd(10)} ${base} ${b.toFixed(2).padStart(7)}`;
      for (const [name] of variants.slice(1)) {
        const m = med(byVariant[name]);
        const wins = byVariant[name].filter((x, i) => x < byVariant[base][i]).length;
        line += `  ${name} ${(((m - b) / b) * 100).toFixed(1).padStart(6)}% (${wins}/${sessions})`;
      }
      console.log(line);
    }
  }
}
console.log(contended.length ? `\ncontended: ${contended.join('; ')}` : '\nquiet: every session started below 10% of a core');
server.close();
