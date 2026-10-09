/**
 * **Builds raced on the DOM benchmark, three engines, typical case** (the scheduler, 2026-10-08).
 *
 *   node bench/dom/race.mjs <sessions> <variant=bundle.js>... [--only=VeraJS own,VeraJS default] [--engines=chrome,firefox,webkit]
 *
 * Each variant is a bundle `build.mjs` wrote; the page loads it in place of `bundle.js`. Per session, every variant runs
 * once per engine (order rotated), and each operation's MEDIAN of the page's repeats is kept. Reported: the median of
 * the session medians per variant, the change against the first variant, and how many sessions it was faster in — the
 * typical case, never a best-of-N. Name a byte-identical copy as a variant for the A/A control. Chrome is the installed
 * one, headed; the race waits for a quiet machine before each session.
 */
import { chromium, firefox, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const sessions = Number(args[0]);
const variants = args.slice(1).filter((a) => !a.startsWith('--')).map((a) => a.split('='));
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

const BASELINE = /claude|Code Helper|WindowServer|\/ps$|Google Chrome|firefox|Firefox|WebKit|Playwright|node/;
const quiet = async () => {
  for (let tries = 0; tries < 12; tries++) {
    const rows = execSync('ps -Ao pcpu,comm -r').toString().trim().split('\n').slice(1, 6).map((l) => l.trim().match(/^([\d.]+)\s+(.*)$/)).filter(Boolean);
    const busy = rows.find((m) => Number(m[1]) > 10 && !BASELINE.test(m[2]));
    if (!busy) return null;
    if (tries === 11) return `${busy[1]}% ${busy[2].slice(0, 60)}`;
    await new Promise((r) => setTimeout(r, 10000));
  }
};
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const contended = [];

for (const engine of engines) {
  const browser = engine === 'chrome' ? await chromium.launch({ channel: 'chrome', headless: false }) : engine === 'firefox' ? await firefox.launch() : await webkit.launch();
  const data = {};
  for (let session = 0; session < sessions; session++) {
    const busy = await quiet();
    if (busy) contended.push(`${engine}/${session}: ${busy}`);
    for (const [name, file] of variants.map((_, i) => variants[(i + session) % variants.length])) {
      const page = await browser.newPage();
      await page.route('**/bundle.js', (route) => route.fulfill({ body: readFileSync(join(directory, file)), contentType: 'text/javascript' }));
      await page.goto(`http://localhost:8098/?only=${encodeURIComponent(only)}${ops ? `&ops=${ops}` : ''}`);
      await page.waitForFunction(() => document.getElementById('status')?.textContent === 'Ready.', null, { timeout: 60000 });
      await page.click('#run');
      await page.waitForFunction(() => window.__RESULTS__ !== undefined, null, { timeout: 900000 });
      const results = await page.evaluate(() => window.__RESULTS__);
      await page.close();
      for (const [op, byImpl] of Object.entries(results))
        for (const [impl, r] of Object.entries(byImpl)) ((data[impl] ??= {})[op] ??= {})[name] = [...(data[impl][op][name] ?? []), r?.median ?? NaN];
    }
  }
  await browser.close();
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
