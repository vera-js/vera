/**
 * Drives `bench/dom/index.html` in headless Chromium and prints the table.
 *
 *   node bench/dom/build.mjs && node bench/dom/run.mjs [sessions]
 *
 * There was no runner and no page, so `docs/features/performance.md`'s browser numbers had no
 * harness anyone could re-run — and the harness itself had stopped building, which is how it stayed
 * that way. This closes both halves: one command, from a clean checkout, to the table.
 *
 * **Run more than one session and read the minimum.** These operations are small enough that a
 * single headless session is dominated by noise: measured across three sessions on one machine,
 * `swap` for the same build came back 12.1, 3.3 and 3.6 ms while Lit sat at 3.2–3.9 throughout. The
 * first of those reads as a 4x regression and is nothing at all. That is why the published
 * methodology is "fastest of seven runs, means of three sessions", and why a one-session result
 * should never be written into a document.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';

const sessions = Number(process.argv[2] ?? 3);
const directory = new URL('.', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };

if (!existsSync(join(directory, 'bundle.js'))) {
  console.error('  bench/dom/bundle.js is missing — run `node bench/dom/build.mjs` first.');
  process.exit(1);
}

const server = createServer((request, response) => {
  const path = join(directory, request.url === '/' ? 'index.html' : decodeURIComponent(request.url.split('?')[0]));
  if (!existsSync(path)) {
    response.writeHead(404);
    return response.end('not found');
  }
  response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
  response.end(readFileSync(path));
});
await new Promise((resolve) => server.listen(8099, resolve));

const browser = await chromium.launch();
const runs = [];
for (let session = 1; session <= sessions; session++) {
  const page = await browser.newPage();
  const failures = [];
  page.on('pageerror', (error) => failures.push(String(error).slice(0, 200)));
  await page.goto('http://localhost:8099/');
  await page.waitForFunction(() => document.getElementById('status')?.textContent === 'Ready.', null, { timeout: 60000 });
  await page.click('#run');
  await page.waitForFunction(() => window.__RESULTS__ !== undefined, null, { timeout: 900000 });
  runs.push(await page.evaluate(() => window.__RESULTS__));
  if (failures.length) console.error(`  session ${session} page errors:`, failures);
  await page.close();
  console.error(`  session ${session}/${sessions} done`);
}
await browser.close();
server.close();

/** The fastest each implementation managed across every session — noise here is one-sided. */
const operations = Object.keys(runs[0]);
const implementations = Object.keys(runs[0][operations[0]]);
const best = (operation, name) => Math.min(...runs.map((run) => run[operation][name]?.min ?? Infinity));

console.log(`\n  ms, fastest across ${sessions} session(s). Lower is better.\n`);
console.log('  ' + 'operation'.padEnd(12) + implementations.map((n) => n.padStart(13)).join(''));
for (const operation of operations) {
  const times = implementations.map((name) => best(operation, name));
  const fastest = Math.min(...times);
  console.log(
    '  ' +
      operation.padEnd(12) +
      times.map((t) => `${t === fastest ? '*' : ' '}${t.toFixed(1)}`.padStart(13)).join('')
  );
}
console.log('\n  * fastest for that operation.');
