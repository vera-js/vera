/**
 * **Field creation against the leading component libraries** (Brian, 2026-11-25: "if we beat competitors it's fine").
 * Each arm mounts the same form field 300 times: a label, an email input and a hint. Vera's `<vera-field>` around a
 * `<vera-input>` (the look on: the equivalent of a text field that draws its own box), Vera's field around a plain
 * input, MUI's `TextField` (React 19, emotion's default cache), Chakra v3's `Field` with `Input` (inside its Provider),
 * Shoelace's `<sl-input>` (cherry-picked, its light theme linked, as its docs say), and hand-written HTML with no
 * script and no look (the floor).
 *
 * Timed, after the library has loaded: mounting the 300, until the library says it is done (React's first commit by
 * `flushSync`, Shoelace's `updateComplete` on every element, Vera's `flush()`), then one forced layout. Each sample is
 * a fresh page, the arms shuffled by a seed. Production builds: the React arms bundled by esbuild with
 * NODE_ENV=production and minified; Vera's arms load the bundles a checkout built (`VERA_ROOT`, its `dist/*.min.js`,
 * through the import map its components page writes).
 *
 * BAR (written before the data): per engine, Vera's median <= the fastest competitor's median. CONTROL, every sample:
 * the page holds 300 textboxes whose accessible name is "Email" (Playwright's own computation, across shadow roots),
 * so an arm that rendered nothing cannot read as fast.
 *
 * Run (from bench/): node components/field-race.mjs [samples per arm] [chromium|firefox|webkit]
 *   VERA_ROOT=<a vera checkout with built dist> (default: this one)
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const BENCH = join(HERE, '..');
const REPO = join(BENCH, '..');
const VERA_ROOT = process.env.VERA_ROOT ?? REPO;
const SAMPLES = Number(process.argv[2] ?? 15);
const ENGINE = process.argv[3] ?? 'chromium';
const N = 300;
const OUT = join(HERE, '.out');
mkdirSync(OUT, { recursive: true });

/** The repo root's esbuild (the bench's own skipped its install script). */
const esbuild = createRequire(join(REPO, 'package.json'))('esbuild');
const versionOf = (pkg) => JSON.parse(readFileSync(join(BENCH, 'node_modules', pkg, 'package.json'), 'utf8')).version;

const ENTRIES = {
  mui: `import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import TextField from '@mui/material/TextField';
window.mount = (n) => {
  const box = document.createElement('div');
  document.body.append(box);
  const items = [];
  for (let i = 0; i < n; i++) items.push(h(TextField, { key: i, label: 'Email', type: 'email', helperText: "We'll never share it." }));
  flushSync(() => createRoot(box).render(h('div', null, items)));
};
window.ready = true;`,
  chakra: `import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ChakraProvider, defaultSystem, Field, Input } from '@chakra-ui/react';
window.mount = (n) => {
  const box = document.createElement('div');
  document.body.append(box);
  const items = [];
  for (let i = 0; i < n; i++)
    items.push(h(Field.Root, { key: i }, h(Field.Label, null, 'Email'), h(Input, { type: 'email' }), h(Field.HelperText, null, "We'll never share it.")));
  flushSync(() => createRoot(box).render(h(ChakraProvider, { value: defaultSystem }, items)));
};
window.ready = true;`,
  shoelace: `import '@shoelace-style/shoelace/dist/components/input/input.js';
await customElements.whenDefined('sl-input');
window.mount = async (n) => {
  const box = document.createElement('div');
  for (let i = 0; i < n; i++) {
    const el = document.createElement('sl-input');
    el.label = 'Email';
    el.type = 'email';
    el.helpText = "We'll never share it.";
    box.append(el);
  }
  document.body.append(box);
  await Promise.all([...box.children].map((el) => el.updateComplete));
};
window.ready = true;`,
};

for (const [name, source] of Object.entries(ENTRIES)) {
  writeFileSync(join(OUT, `${name}.entry.js`), source);
  await esbuild.build({
    entryPoints: [join(OUT, `${name}.entry.js`)],
    outfile: join(OUT, `${name}.js`),
    bundle: true,
    format: 'esm',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    nodePaths: [join(BENCH, 'node_modules')],
    logLevel: 'error',
  });
}

/** Vera's page: the checkout's components-page import map, renderer and styles wired, field and input loaded. */
const veraMap = /<script type="importmap">([\s\S]*?)<\/script>/.exec(readFileSync(join(VERA_ROOT, 'examples/components/index.html'), 'utf8'))[1];
const FIELD_WITH_INPUT = `<vera-field><label>Email</label><vera-input><input type="email"></vera-input><small data-vera-part="hint">We'll never share it.</small></vera-field>`;
const FIELD_PLAIN = `<vera-field><label>Email</label><input type="email"><small data-vera-part="hint">We'll never share it.</small></vera-field>`;
const veraPage = (markup) =>
  `<!DOCTYPE html><script type="importmap">${veraMap}</script><body><script type="module">
const { wire, flush } = await import('@verajs/core');
const { renderer } = await import('@verajs/renderer');
const { styles } = await import('@verajs/styles');
wire([renderer, styles]);
await import('@vera-components/field');
await import('@vera-components/input');
const ONE = ${JSON.stringify(markup)};
window.mount = (n) => { const box = document.createElement('div'); box.innerHTML = ONE.repeat(n); document.body.append(box); flush(); };
window.ready = true;
</script>`;
const FLOOR_ONE = (i) => `<div><label for="e${i}">Email</label><input id="e${i}" type="email"><small>We'll never share it.</small></div>`;
const PAGES = {
  'vera field+input': veraPage(FIELD_WITH_INPUT),
  'vera field': veraPage(FIELD_PLAIN),
  'mui TextField': `<!DOCTYPE html><body><script type="module" src="/out/mui.js"></script>`,
  'chakra Field': `<!DOCTYPE html><body><script type="module" src="/out/chakra.js"></script>`,
  'shoelace sl-input': `<!DOCTYPE html><link rel="stylesheet" href="/sl/light.css"><body class="sl-theme-light"><script type="module" src="/out/shoelace.js"></script>`,
  'html floor': `<!DOCTYPE html><body><script type="module">
window.mount = (n) => { let s = ''; for (let i = 0; i < n; i++) s += ${JSON.stringify(FLOOR_ONE('§'))}.replaceAll('§', i); const box = document.createElement('div'); box.innerHTML = s; document.body.append(box); };
window.ready = true;
</script>`,
};
const COMPETITORS = ['mui TextField', 'chakra Field', 'shoelace sl-input'];

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json' };
const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const send = (path) => {
    try {
      res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(readFileSync(path));
    } catch {
      res.writeHead(404).end();
    }
  };
  if (url.startsWith('/page/')) return res.writeHead(200, { 'content-type': 'text/html' }).end(PAGES[url.slice(6)]);
  if (url.startsWith('/out/')) return send(join(OUT, url.slice(5)));
  if (url.startsWith('/sl/')) return send(join(BENCH, 'node_modules/@shoelace-style/shoelace/dist/themes', url.slice(4)));
  if (url.startsWith('/packages/')) return send(join(VERA_ROOT, url));
  res.writeHead(404).end();
}).listen(0);
const origin = `http://localhost:${server.address().port}`;

/** A seeded shuffle (mulberry32), so a run is repeatable and the arms interleave. */
let seed = 0x5eed;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const order = Object.keys(PAGES).flatMap((arm) => Array.from({ length: SAMPLES }, () => arm));
for (let i = order.length - 1; i > 0; i--) {
  const j = Math.floor(random() * (i + 1));
  [order[i], order[j]] = [order[j], order[i]];
}

const engine = { chromium, firefox, webkit }[ENGINE];
const times = Object.fromEntries(Object.keys(PAGES).map((arm) => [arm, []]));
const failed = [];
/** Firefox gets a fresh browser per page (its process reuse carries state between pages); the others a fresh page. */
let browser = ENGINE === 'firefox' ? null : await engine.launch({ headless: false });
try {
  for (const arm of order) {
    if (ENGINE === 'firefox') browser = await engine.launch({ headless: false });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const said = [];
    page.on('pageerror', (e) => said.push(e.message));
    await page.goto(`${origin}/page/${encodeURIComponent(arm)}`);
    await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
    const ms = await page.evaluate(async (n) => {
      const t0 = performance.now();
      await window.mount(n);
      void document.body.offsetHeight;
      return performance.now() - t0;
    }, N);
    const named = await page.getByRole('textbox', { name: 'Email' }).count();
    if (named !== N || said.length) failed.push(`${arm}: ${named} named textboxes${said.length ? `; ${said[0]}` : ''}`);
    times[arm].push(ms);
    await page.close();
    if (ENGINE === 'firefox') await browser.close();
  }
} finally {
  if (ENGINE !== 'firefox') await browser.close();
  server.close();
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return (s[s.length >> 1] + s[(s.length - 1) >> 1]) / 2;
};
const m = Object.fromEntries(Object.entries(times).map(([arm, xs]) => [arm, median(xs)]));
console.log(`field x${N}, ${ENGINE} ${browser?.version?.() ?? ''}, ${SAMPLES} fresh pages per arm`);
console.log(`versions: react ${versionOf('react')}, @mui/material ${versionOf('@mui/material')}, @chakra-ui/react ${versionOf('@chakra-ui/react')}, @shoelace-style/shoelace ${versionOf('@shoelace-style/shoelace')}`);
for (const [arm, ms] of Object.entries(m).sort((a, b) => a[1] - b[1]))
  console.log(`  ${arm.padEnd(20)} ${ms.toFixed(2).padStart(8)} ms   (min ${Math.min(...times[arm]).toFixed(2)}, max ${Math.max(...times[arm]).toFixed(2)})`);
const fastest = Math.min(...COMPETITORS.map((arm) => m[arm]));
for (const arm of ['vera field+input', 'vera field'])
  console.log(`BAR ${arm} <= fastest competitor (${fastest.toFixed(2)}): ${m[arm] <= fastest ? 'BEATS' : 'LOSES'} (${(fastest / m[arm]).toFixed(1)}x)`);
console.log(failed.length ? `CONTROL FAILED:\n  ${[...new Set(failed)].join('\n  ')}` : `CONTROL: every sample held ${N} textboxes named "Email"`);
