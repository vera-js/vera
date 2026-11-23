/**
 * **The components page, built from the repo as it stands**: one plate per component package that has a
 * `src/<folder>/demo.ts` (its `ComponentDemo`: what to judge and each state it ships with, as markup), and an import
 * map to the production bundles those plates run, found by following each bundle's own bare imports from the package's
 * `exports`. `scripts/build-components-page.mjs` writes it to `index.html` (and `--check`s it in the gate).
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

/** Every component with a demo, in name order, the demo read from its TypeScript source (Node strips the types). */
export const componentDemos = async (root) => {
  const demos = [];
  const base = join(root, 'packages', 'components');
  for (const name of readdirSync(base).sort()) {
    const src = join(base, name, 'src');
    if (!existsSync(src)) continue;
    const folder = readdirSync(src).find((entry) => existsSync(join(src, entry, 'demo.ts')));
    if (folder === undefined) continue;
    const demo = Object.values(await import(pathToFileURL(join(src, folder, 'demo.ts')).href))[0];
    demos.push({ name, demo });
  }
  return demos;
};

const plate = ({ name, demo }) => `  <section class="plate" id="${name}">
    <div>
      <h2>${escape(titled(name))}</h2>
      <p class="ask">${escape(demo.ask)}</p>
      <span class="pkg">@vera-components/${name}</span>${
        demo.interactive?.length
          ? `\n      <p class="reach">Reached by doing: ${demo.interactive.map((i) => `${escape(i.part)} (${escape(i.how)})`).join('; ')}.</p>`
          : ''
      }
    </div>
    <div class="stage">
${demo.states
  .map(
    (state) =>
      `      <div class="cell${state.markup.length > 220 ? ' wide' : ''}"><h3>${escape(state.title)}</h3><div class="show">${state.markup}</div>${
        state.note ? `<span class="say">${escape(state.note)}</span>` : ''
      }</div>`,
  )
  .join('\n')}
    </div>
  </section>`;

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
    .replace('<!--GENERATED-->', '<!-- Generated from template.html and each package\'s demo.ts by scripts/build-components-page.mjs: edit those, then run it. -->')
    .replace('<!--IMPORTMAP-->', `${sheets.join('\n')}\n<script type="importmap">${JSON.stringify({ imports }, null, 1)}</script>`)
    .replace('<!--PLATES-->', demos.map(plate).join('\n\n'))
    .replace('/*COMPONENTS*/[]', JSON.stringify(demos.map(({ name }) => name)));
};
