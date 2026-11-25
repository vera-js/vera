/**
 * **`examples/components/`**: the page the server builds holds a plate for every component package that has a
 * `demo.ts`, a state card for each of its states, and an import map whose every target is a built file in this repo,
 * with no template marker left. Against the built tree (the page serves `dist/` bytes as written).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { componentDemos, componentsPage } from '../examples/components/page.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const html = await componentsPage(root);
const demos = await componentDemos(root);

test('every component package with a demo.ts has its plate, and its states each a card', () => {
  const withDemo = readdirSync(join(root, 'packages/components')).filter((name) => {
    const src = join(root, 'packages/components', name, 'src');
    return existsSync(src) && readdirSync(src).some((folder) => existsSync(join(src, folder, 'demo.ts')));
  });
  assert.ok(withDemo.length >= 9, `positive control: the scan finds the demos (found ${withDemo.length})`);
  assert.deepEqual(demos.map(({ name }) => name), [...withDemo].sort());
  for (const { name, demo } of demos) {
    const at = html.indexOf(`<section class="plate" id="${name}">`);
    assert.notEqual(at, -1, `${name} has a plate`);
    /** To the next plate (or the end of main): a state's markup may hold sections of its own (tabs' panels). */
    const next = html.indexOf('<section class="plate"', at + 1);
    const plate = html.slice(at, next === -1 ? html.indexOf('</main>', at) : next);
    assert.equal(plate.split('<article class="card').length - 1, demo.states.length, `${name}: one card per state`);
  }
});

test('the import map names every component and the core modules, and each target is a built file', () => {
  const { imports } = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1]);
  for (const specifier of ['@verajs/core', '@verajs/renderer', '@verajs/renderer/slots', ...demos.map(({ name }) => `@vera-components/${name}`)])
    assert.ok(imports[specifier], `${specifier} is mapped`);
  for (const [specifier, path] of Object.entries(imports)) {
    assert.match(path, /^\/packages\/.+\.js$/, `${specifier} maps into packages/`);
    assert.ok(existsSync(join(root, path)), `${specifier} → ${path} exists`);
  }
});

test('no template marker is left, and the page loads the components it shows', () => {
  assert.doesNotMatch(html, /<!--(GENERATED|IMPORTMAP|NAV|COUNT|FIRST|PLATES)-->|\/\*(WIRING|COMPONENTS)\*\//);
  assert.ok(html.includes(JSON.stringify(demos.map(({ name }) => name))), 'the loader list is the plates');
});
