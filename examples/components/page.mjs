/**
 * **The components page, built from the repo as it stands**: one section per component package that has a
 * `src/<folder>/demo.ts` (its `ComponentDemo`: what to try and each state it ships with, as markup), led by the
 * description its `surface.ts` declares, and an import map to the production bundles those sections run, found by
 * following each bundle's own bare imports from the package's `exports`. A state marked `framed` (one that takes over
 * its page, a modal open at load) runs in a frame of its own, as does a state that `wires` modules of its own (wiring
 * is page-wide); its Code panel shows the wiring above the markup. `scripts/build-components-page.mjs` writes it to
 * `index.html` (and `--check`s it in the gate).
 *
 *   import { componentsPage } from './page.mjs';
 *   const html = await componentsPage(repoRoot);   // throws naming any bundle that is not built
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const titled = (name) => name.replace(/(^|-)([a-z])/g, (_, dash, c) => (dash ? ' ' : '') + c.toUpperCase());

/** Every package directory, by its npm name, relative to the repo root. */
const packageDirs = (root) => {
  const dirs = new Map();
  for (const group of ['', 'components/', 'hooks/']) {
    const base = join(root, 'packages', group);
    for (const name of readdirSync(base)) {
      const file = join(base, name, 'package.json');
      if (existsSync(file)) dirs.set(JSON.parse(readFileSync(file, 'utf8')).name, `packages/${group}${name}`);
    }
  }
  return dirs;
};

/** A bare specifier's production file, `exports[…].default`, as a repo-relative path; null when it is not exported. */
const resolver = (root, dirs) => (specifier) => {
  const [scope, name, ...rest] = specifier.split('/');
  const dir = dirs.get(`${scope}/${name}`);
  if (dir === undefined) throw new Error(`no package ${scope}/${name} in this repo`);
  const entry = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8')).exports[rest.length ? `./${rest.join('/')}` : '.'];
  if (entry === undefined) return null;
  const path = `${dir}/${(typeof entry === 'string' ? entry : entry.default).replace(/^\.\//, '')}`;
  if (!existsSync(join(root, path))) throw new Error(`${specifier} → ${path} is not built: run npm run build first`);
  return path;
};

/** A component's source module that exports one value (`demo.ts`, `surface.ts`), read by Node with its types stripped. */
const sourceValue = async (src, file) => {
  const folder = readdirSync(src).find((entry) => existsSync(join(src, entry, file)));
  return folder === undefined ? null : Object.values(await import(pathToFileURL(join(src, folder, file)).href))[0];
};

/** Every component with a demo, in name order, with its surface (for the description the page leads with). */
export const componentDemos = async (root) => {
  const demos = [];
  const base = join(root, 'packages', 'components');
  for (const name of readdirSync(base).sort()) {
    const src = join(base, name, 'src');
    if (!existsSync(src)) continue;
    const demo = await sourceValue(src, 'demo.ts');
    if (demo === null) continue;
    demos.push({ name, demo, surface: await sourceValue(src, 'surface.ts') });
  }
  return demos;
};

/** The page's own wiring, the same in the page and in every frame: what a page using every component wires. */
const WIRING =
  "const{wire}=await import('@verajs/core');const{renderer}=await import('@verajs/renderer');" +
  "const{lists}=await import('@verajs/renderer/keyed');const{slots}=await import('@verajs/renderer/slots');" +
  "const{styles}=await import('@verajs/styles');wire([renderer,lists,slots,styles]);";

/** The components a piece of markup uses, by package name. */
const usedIn = (markup) => [...new Set([...markup.matchAll(/<vera-([a-z-]+)/g)].map((match) => match[1]))];

/** A state's own modules, wired after the page's and before its components load (a module wired later misses them). */
const wiresOf = (wires = []) =>
  wires.map(({ from, name }, i) => `const{${name}:w${i}}=await import(${JSON.stringify(from)});wire([w${i}]);`).join('');

/** What an author writes to wire a state's modules, shown above its markup in the Code panel. */
const wiringCode = (wires = []) =>
  wires.map(({ from, name }) => `import { ${name} } from '${from}';\nwire([${name}]);`).join('\n');

/**
 * A framed state's document: the page's import map and wiring, the state's own modules, the state's markup, and only
 * the components it uses. The page's script hands it the theme (color scheme, accent, radius) when it loads and on
 * every change.
 */
const frameDoc = (imports, markup, wires) =>
  '<!DOCTYPE html><html><head><meta charset="utf-8">' +
  '<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,sans-serif}</style>' +
  `<script type="importmap">${JSON.stringify({ imports })}</script></head><body>${markup}` +
  `<script type="module">${WIRING}${wiresOf(wires)}${usedIn(markup).map((name) => `await import('@vera-components/${name}');`).join('')}</script></body></html>`;

const card = (imports) => (state) => {
  /** Wiring is page-wide: a state that wires its own modules is framed, so the rest of the page keeps its wiring. */
  const framed = state.framed || (state.wires?.length ?? 0) > 0;
  const preview = framed ? `<iframe class="frame" title="${escape(state.title)}" srcdoc="${escape(frameDoc(imports, state.markup, state.wires))}"></iframe>` : state.markup;
  const wide = framed || state.markup.length > 220 ? ' wide' : '';
  const code = state.wires?.length ? `${wiringCode(state.wires)}\n\n${state.markup}` : state.markup;
  return [
    `      <article class="card${wide}">`,
    `        <div class="preview">${preview}</div>`,
    `        <footer>`,
    `          <h3>${escape(state.title)}</h3>${state.note ? `<p>${escape(state.note)}</p>` : ''}`,
    `          <details class="code"><summary>Code</summary><button type="button" class="copy" data-copy>Copy</button><pre><code>${escape(code)}</code></pre></details>`,
    `        </footer>`,
    `      </article>`,
  ].join('\n');
};

const plate = (imports) => ({ name, demo, surface }) => {
  const reach = demo.interactive?.length
    ? `\n      <p class="try"><strong>Reached by doing</strong> ${demo.interactive.map((i) => `${escape(i.part)} (${escape(i.how)})`).join('; ')}.</p>`
    : '';
  return [
    `  <section class="plate" id="${name}">`,
    `    <header class="plate-head">`,
    `      <div class="title-row"><h2>${escape(titled(name))}</h2><span class="pill" data-size="@vera-components/${name}">gzip …</span></div>`,
    `      <p class="lede">${escape(surface?.description ?? '')}</p>`,
    `      <p class="try"><strong>Try it</strong> ${escape(demo.ask)}</p>${reach}`,
    `      <code class="install">npm i @vera-components/${name}</code>`,
    `    </header>`,
    `    <div class="grid">`,
    demo.states.map(card(imports)).join('\n'),
    `    </div>`,
    `  </section>`,
  ].join('\n');
};

const navItem = ({ name }) => `<a href="#${name}">${escape(titled(name))}</a>`;

/** The page's HTML, its import map and sheets addressed from the repo root (`/packages/…`), as the server serves it. */
export const componentsPage = async (root) => {
  const demos = await componentDemos(root);
  if (demos.length === 0) throw new Error('no component has a demo.ts: nothing to show');
  const resolve = resolver(root, packageDirs(root));
  const imports = {};
  const queue = ['@verajs/core', '@verajs/renderer', '@verajs/renderer/keyed', '@verajs/renderer/slots', '@verajs/styles', ...demos.map(({ name }) => `@vera-components/${name}`)];
  while (queue.length > 0) {
    const specifier = queue.shift();
    if (imports[specifier]) continue;
    const path = resolve(specifier);
    if (path === null) throw new Error(`${specifier} is imported and not exported`);
    imports[specifier] = `/${path}`;
    for (const [, next] of readFileSync(join(root, path), 'utf8').matchAll(/(?:from|import)\s*["'](@ver[a-z-]+\/[^"']+)["']/g)) queue.push(next);
  }
  /** A component's pre-upgrade sheet, where it ships one, so a state looks right before its script runs. */
  const sheets = demos
    .map(({ name }) => resolve(`@vera-components/${name}/preupgrade.css`))
    .filter((path) => path !== null)
    .map((path) => `<link rel="stylesheet" href="/${path}">`);
  const template = readFileSync(join(import.meta.dirname, 'template.html'), 'utf8');
  return template
    .replace('<!--GENERATED-->', () => "<!-- Generated from template.html and each package's demo.ts by scripts/build-components-page.mjs: edit those, then run it. -->")
    .replace('<!--IMPORTMAP-->', () => `${sheets.join('\n')}\n<script type="importmap">${JSON.stringify({ imports }, null, 1)}</script>`)
    .replace('<!--NAV-->', () => demos.map(navItem).join(''))
    .replace('<!--COUNT-->', () => String(demos.length))
    .replace('<!--FIRST-->', () => demos[0].name)
    .replace('<!--PLATES-->', () => demos.map(plate(imports)).join('\n\n'))
    .replace('/*WIRING*/', () => WIRING)
    .replace('/*COMPONENTS*/[]', () => JSON.stringify(demos.map(({ name }) => name)));
};
