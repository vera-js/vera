/**
 * **`@verajs/hot/vite` — the Vite adapter** (2026-10-25). Which modules a save may swap in place (a module CALLING
 * `define`, whose exports are only components), and end to end: a real Vite dev server, a real edit, the live element
 * swapped in place, a store from ANOTHER module the same instance after the edit, setup run once more.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { hotVite, swappable } = await import(join(root, 'packages/hot/dist/development/vera-hot-vite.js'));

test('a module CALLING define is swappable — both forms — and lookalikes are not', () => {
  assert.equal(swappable(`define('x-a', () => () => 1);`), true, 'define(');
  assert.equal(swappable(`customElements.define('x-b', class extends HTMLElement {});`), true, 'customElements.define(');
  assert.equal(swappable(`redefine('x');`), false, 'redefine(');
  assert.equal(swappable(`Object.defineProperty(o, 'k', {});`), false, 'defineProperty(');
  assert.equal(swappable(`registry.define('x');`), false, 'a member call that is not customElements');
  assert.equal(swappable(`// define('x', ...) in a comment\nconst a = 1;`), false, 'a comment mentioning define');
});

test('only when its exports are components: nothing, what define returns, or a class — anything else propagates (vera-5a)', () => {
  assert.equal(swappable(`export const XCard = define('x-card', () => () => 1);`), true);
  assert.equal(swappable(`export default define('x-card', () => () => 1);`), true);
  assert.equal(swappable(`export class XCard extends HTMLElement {}\ncustomElements.define('x-card', XCard);`), true);
  assert.equal(swappable(`export const store = createStore({});\ndefine('x-card', () => () => 1);`), false, 'an exported store would split');
  assert.equal(swappable(`export { helper };\ndefine('x-card', () => () => 1);`), false, 'an export list');
  assert.equal(swappable(`export function helper() {}\ndefine('x-card', () => () => 1);`), false, 'an exported function');
});

test('the plugin: development only, appends the accept to a swappable module and to nothing else', () => {
  const p = hotVite();
  assert.deepEqual([p.name, p.apply], ['vera-hot', 'serve']);
  assert.match(p.transform(`define('x-c', () => () => 1);`, '/app/card.js').code, /import\.meta\.hot\.accept\(\);\n$/);
  assert.equal(p.transform(`const a = 1;`, '/app/util.js'), null, 'no define');
  assert.equal(p.transform(`define('x-c', () => () => 1);`, '/app/node_modules/lib/card.js'), null, 'a dependency');
  assert.equal(p.transform(`define('x-c', () => () => 1);`, '/app/card.css'), null, 'not a script');
});

test('END TO END: a real Vite dev server, a real edit — swapped in place, a store from another module the SAME instance, setup once more', { timeout: 120000 }, async () => {
  const { createServer } = await import('vite');
  const { chromium } = await import('playwright');
  /** `.probe/` is gitignored, so a fresh checkout has none: made here, or `mkdtemp` fails before the test begins. */
  mkdirSync(join(root, '.probe'), { recursive: true });
  const dir = mkdtempSync(join(root, '.probe', 'hot-vite-'));
  const card = join(dir, 'card.js');
  const write = (label) => writeFileSync(card, `import { define, html } from '@verajs/core';\nimport { shared } from './shared.js';\nwindow.__setups = (window.__setups ?? 0) + 1;\ndefine('x-vcard', () => () => html\`<b>${label} \${shared.n}</b>\`);\n`);
  writeFileSync(join(dir, 'shared.js'), `import { createStore } from '@verajs/core';\nexport const shared = createStore({ n: 1 });\nwindow.__shared = shared;\n`);
  writeFileSync(join(dir, 'main.js'), `import { wire } from '@verajs/core';\nimport { renderer } from '@verajs/renderer';\nimport { hot } from '@verajs/hot';\nwire([renderer, hot]);\nawait import('./card.js');\ndocument.body.append(document.createElement('x-vcard'));\nwindow.__ready = true;\n`);
  writeFileSync(join(dir, 'index.html'), `<!doctype html><body><script type="module" src="/main.js"></script></body>`);
  write('one');
  const server = await createServer({ root: dir, configFile: false, logLevel: 'silent', plugins: [hotVite()], server: { port: 0 }, resolve: { conditions: ['development'] } });
  await server.listen();
  const url = server.resolvedUrls.local[0];
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url);
    await page.waitForFunction(() => window.__ready === true && document.querySelector('x-vcard')?.textContent === 'one 1', null, { timeout: 30000 });
    await page.evaluate(() => { window.__el = document.querySelector('x-vcard'); window.__store = window.__shared; window.__shared.n = 2; });
    await page.waitForFunction(() => document.querySelector('x-vcard').textContent === 'one 2');
    write('two');
    await page.waitForFunction(() => document.querySelector('x-vcard')?.textContent === 'two 2', null, { timeout: 30000 });
    const r = await page.evaluate(() => ({ same: document.querySelector('x-vcard') === window.__el, store: window.__shared === window.__store, setups: window.__setups, reloaded: performance.getEntriesByType('navigation').length }));
    assert.deepEqual(r, { same: true, store: true, setups: 2, reloaded: 1 }, 'the element kept, the other module\'s store the same instance and value, the card module run once more, no page reload');
  } finally {
    await browser.close();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
