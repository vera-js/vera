/**
 * **Component creation against the leading component libraries** (Brian, 2026-11-25: "if we beat competitors it's
 * fine"). One harness, one race per component (`RACES` below): each arm mounts the same control N times, Vera's own
 * arms, the libraries' equivalents (MUI with React 19 and emotion's default cache, Chakra v3 inside its Provider,
 * Shoelace's cherry-picked element with its light theme linked, each as its docs say), and hand-written HTML with no
 * script and no look (the floor).
 *
 * Timed, after the library has loaded and the page has settled (two frames and 100 ms, for every arm: an arm whose
 * script runs inline starts before the page's first render and reads about 3x cheap, measured) and then spun busy
 * for `RAMP_MS` (100 ms, so the window times a running core, not one slowed by the settle's idle): mounting the N, until
 * the library says it is done (React's first commit by `flushSync`, Shoelace's `updateComplete` on every element,
 * Vera's `flush()`), then one forced layout. Each sample is a fresh page, the arms shuffled by a seed. Production
 * builds: the React arms bundled by esbuild with NODE_ENV=production and minified; Vera's arms load the bundles a
 * checkout built (`VERA_ROOT`, its `dist/*.min.js`, through the import map its components page writes).
 *
 * BAR (written before the data): per engine, each Vera arm's median <= the fastest competitor's median. CONTROL, every
 * sample: when the clock stops, N of the race's controls are already rendered (counted in that same task, through
 * shadow roots), and afterwards the page holds N controls of the race's role whose accessible name is the race's name (Playwright's own
 * computation, across shadow roots), so an arm that rendered nothing cannot read as fast.
 *
 * Run (from bench/): node components/race.mjs <field|checkbox> [samples per arm] [chromium|firefox|webkit]
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
const RACE = process.argv[2];
const SAMPLES = Number(process.argv[3] ?? 15);
const ENGINE = process.argv[4] ?? 'chromium';
/**
 * A busy spin between the settle and t0, in ms (2026-11-26): on the Apple Silicon laptop these tables are taken on, an
 * idle before a cold sample makes it time a slowed core (a cold window read 27.8 ms after a 30 ms idle, 36.2 ms after
 * 100 ms, 55.3 ms after a second, and 23.7 ms after a 100 ms spin; BROWSER-LEDGER), and a real page does not begin its
 * work after idle. `RAMP_MS=0` times the settled page as before.
 */
const RAMP_MS = Number(process.env.RAMP_MS ?? 100);
const OUT = join(HERE, '.out');
mkdirSync(OUT, { recursive: true });

/** A React arm's entry: `items(h, n)` builds the n elements, `wrap(h, items)` the root they render in. */
const reactEntry = (imports, items, wrap = 'h("div", null, items)') => `import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
${imports}
window.mount = (n) => {
  const box = document.createElement('div');
  document.body.append(box);
  const items = [];
  for (let i = 0; i < n; i++) items.push(${items});
  flushSync(() => createRoot(box).render(${wrap}));
};
window.ready = true;`;

/** A Shoelace arm's entry: `make` sets up one element `el`. */
const shoelaceEntry = (path, tag, make) => `import '@shoelace-style/shoelace/dist/components/${path}';
await customElements.whenDefined('${tag}');
window.mount = async (n) => {
  const box = document.createElement('div');
  for (let i = 0; i < n; i++) {
    const el = document.createElement('${tag}');
    ${make}
    box.append(el);
  }
  document.body.append(box);
  await Promise.all([...box.children].map((el) => el.updateComplete));
};
window.ready = true;`;

/**
 * Each race: N, the control (role and name every sample must hold N of), Vera's arms (markup, the components they
 * load, and `ran`: the marks each element's setup writes, N of each, so an arm whose script never ran fails, since its
 * plain inputs alone hold the role and name), the competitors' entries, and the floor's markup (`§` is the sample's index, for ids).
 */
const RACES = {
  field: {
    n: 300,
    role: 'textbox',
    /** What the clock must already see rendered when it stops: N of these, in light DOM or any shadow root. */
    atStop: 'input[type="email"]',
    name: 'Email',
    vera: {
      'vera field+input': {
        load: ['field', 'input'],
        ran: ['vera-field[data-vera-field]', 'input[data-vera-input]'],
        markup: `<vera-field><label>Email</label><vera-input><input type="email"></vera-input><small data-vera-part="hint">We'll never share it.</small></vera-field>`,
      },
      'vera field': { load: ['field', 'input'], ran: ['vera-field[data-vera-field]'], markup: `<vera-field><label>Email</label><input type="email"><small data-vera-part="hint">We'll never share it.</small></vera-field>` },
    },
    competitors: {
      'mui TextField': reactEntry(`import TextField from '@mui/material/TextField';`, `h(TextField, { key: i, label: 'Email', type: 'email', helperText: "We'll never share it." })`),
      'chakra Field': reactEntry(
        `import { ChakraProvider, defaultSystem, Field, Input } from '@chakra-ui/react';`,
        `h(Field.Root, { key: i }, h(Field.Label, null, 'Email'), h(Input, { type: 'email' }), h(Field.HelperText, null, "We'll never share it."))`,
        'h(ChakraProvider, { value: defaultSystem }, items)',
      ),
      'shoelace sl-input': shoelaceEntry('input/input.js', 'sl-input', `el.label = 'Email'; el.type = 'email'; el.helpText = "We'll never share it.";`),
    },
    floor: `<div><label for="e§">Email</label><input id="e§" type="email"><small>We'll never share it.</small></div>`,
  },
  checkbox: {
    n: 200,
    role: 'checkbox',
    atStop: 'input[type="checkbox"]',
    name: 'Email me the newsletter',
    vera: {
      'vera checkbox': { load: ['checkbox'], ran: ['input[data-vera-checkbox]'], markup: `<vera-checkbox><label><input type="checkbox" name="news"> Email me the newsletter</label></vera-checkbox>` },
    },
    competitors: {
      'mui Checkbox': reactEntry(
        `import Checkbox from '@mui/material/Checkbox';\nimport FormControlLabel from '@mui/material/FormControlLabel';`,
        `h(FormControlLabel, { key: i, control: h(Checkbox, { name: 'news' }), label: 'Email me the newsletter' })`,
      ),
      'chakra Checkbox': reactEntry(
        `import { ChakraProvider, defaultSystem, Checkbox } from '@chakra-ui/react';`,
        `h(Checkbox.Root, { key: i, name: 'news' }, h(Checkbox.HiddenInput), h(Checkbox.Control), h(Checkbox.Label, null, 'Email me the newsletter'))`,
        'h(ChakraProvider, { value: defaultSystem }, items)',
      ),
      'shoelace sl-checkbox': shoelaceEntry('checkbox/checkbox.js', 'sl-checkbox', `el.name = 'news'; el.textContent = 'Email me the newsletter';`),
    },
    floor: `<label><input type="checkbox" name="news"> Email me the newsletter</label>`,
  },
};
const race = RACES[RACE];
if (race === undefined) throw new Error(`usage: node components/race.mjs <${Object.keys(RACES).join('|')}> [samples] [engine]`);
const { n: N } = race;

/** The repo root's esbuild (the bench's own skipped its install script). */
const esbuild = createRequire(join(REPO, 'package.json'))('esbuild');
const versionOf = (pkg) => JSON.parse(readFileSync(join(BENCH, 'node_modules', pkg, 'package.json'), 'utf8')).version;
const fileOf = (arm) => `${RACE}-${arm.replace(/[^a-z0-9]+/gi, '-')}`;

for (const [arm, source] of Object.entries(race.competitors)) {
  writeFileSync(join(OUT, `${fileOf(arm)}.entry.js`), source);
  await esbuild.build({
    entryPoints: [join(OUT, `${fileOf(arm)}.entry.js`)],
    outfile: join(OUT, `${fileOf(arm)}.js`),
    bundle: true,
    format: 'esm',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    nodePaths: [join(BENCH, 'node_modules')],
    logLevel: 'error',
  });
}

/** Vera's page: the checkout's components-page import map, renderer and styles wired, the arm's components loaded. */
const veraMap = /<script type="importmap">([\s\S]*?)<\/script>/.exec(readFileSync(join(VERA_ROOT, 'examples/components/index.html'), 'utf8'))[1];
const veraPage = ({ load, markup }) =>
  `<!DOCTYPE html><script type="importmap">${veraMap}</script><body><script type="module">
const { wire, flush } = await import('@verajs/core');
const { renderer } = await import('@verajs/renderer');
const { styles } = await import('@verajs/styles');
wire([renderer, styles]);
${load.map((name) => `await import('@vera-components/${name}');`).join('\n')}
const ONE = ${JSON.stringify(markup)};
window.mount = (n) => { const box = document.createElement('div'); box.innerHTML = ONE.repeat(n); document.body.append(box); flush(); };
window.ready = true;
</script>`;
const competitorPage = (arm) =>
  arm.startsWith('shoelace')
    ? `<!DOCTYPE html><link rel="stylesheet" href="/sl/light.css"><body class="sl-theme-light"><script type="module" src="/out/${fileOf(arm)}.js"></script>`
    : `<!DOCTYPE html><body><script type="module" src="/out/${fileOf(arm)}.js"></script>`;
const PAGES = {
  ...Object.fromEntries(Object.entries(race.vera).map(([arm, spec]) => [arm, veraPage(spec)])),
  ...Object.fromEntries(Object.keys(race.competitors).map((arm) => [arm, competitorPage(arm)])),
  'html floor': `<!DOCTYPE html><body><script type="module">
window.mount = (n) => { let s = ''; for (let i = 0; i < n; i++) s += ${JSON.stringify(race.floor)}.replaceAll('§', i); const box = document.createElement('div'); box.innerHTML = s; document.body.append(box); };
window.ready = true;
</script>`,
};
const COMPETITORS = Object.keys(race.competitors);

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
let version = '';
try {
  for (const arm of order) {
    if (ENGINE === 'firefox') browser = await engine.launch({ headless: false });
    version = browser.version();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const said = [];
    page.on('pageerror', (e) => said.push(e.message));
    await page.goto(`${origin}/page/${encodeURIComponent(arm)}`);
    await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
    const { ms, seen } = await page.evaluate(async ([n, selector, ramp]) => {
      await new Promise((settled) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(settled, 100))));
      const ramped = performance.now() + ramp;
      while (performance.now() < ramped);
      const t0 = performance.now();
      await window.mount(n);
      void document.body.offsetHeight;
      const t1 = performance.now();
      /**
       * Counted in the same task as the clock's stop, with nothing able to run in between: the controls the timed work
       * rendered, through every shadow root, so a library that renders after the clock (a later microtask or frame)
       * fails here rather than reading fast.
       */
      const deep = (root) => {
        let found = root.querySelectorAll(selector).length;
        for (const el of root.querySelectorAll('*')) if (el.shadowRoot) found += deep(el.shadowRoot);
        return found;
      };
      return { ms: t1 - t0, seen: deep(document) };
    }, [N, race.atStop, RAMP_MS]);
    if (seen !== N) failed.push(`${arm}: ${seen} of ${race.atStop} rendered when the clock stopped`);
    const named = await page.getByRole(race.role, { name: race.name, exact: true }).count();
    if (named !== N || said.length) failed.push(`${arm}: ${named} named ${race.role}es${said.length ? `; ${said[0]}` : ''}`);
    for (const mark of race.vera[arm]?.ran ?? []) {
      const set = await page.locator(mark).count();
      if (set !== N) failed.push(`${arm}: ${set} of ${mark}, so its setup did not run on every element`);
    }
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
console.log(`${RACE} x${N}, ${ENGINE} ${version}, ${SAMPLES} fresh pages per arm, settled then a ${RAMP_MS} ms spin before t0`);
console.log(`versions: react ${versionOf('react')}, @mui/material ${versionOf('@mui/material')}, @chakra-ui/react ${versionOf('@chakra-ui/react')}, @shoelace-style/shoelace ${versionOf('@shoelace-style/shoelace')}`);
for (const [arm, ms] of Object.entries(m).sort((a, b) => a[1] - b[1]))
  console.log(`  ${arm.padEnd(22)} ${ms.toFixed(2).padStart(8)} ms   (min ${Math.min(...times[arm]).toFixed(2)}, max ${Math.max(...times[arm]).toFixed(2)})`);
const fastest = Math.min(...COMPETITORS.map((arm) => m[arm]));
/** A failed control voids the verdict: an arm that rendered nothing in time reads fast (a plant read 35x "BEATS"). */
for (const arm of Object.keys(race.vera))
  console.log(
    `BAR ${arm} <= fastest competitor (${fastest.toFixed(2)}): ${failed.length ? 'VOID (a control failed)' : m[arm] <= fastest ? 'BEATS' : 'LOSES'} (${(fastest / m[arm]).toFixed(1)}x)`,
  );
console.log(failed.length ? `CONTROL FAILED:\n  ${[...new Set(failed)].join('\n  ')}` : `CONTROL: every sample held ${N} ${race.role}es named "${race.name}"`);
