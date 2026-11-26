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

test('every demo.ts has its plate, a package of two tags one per tag, and its states each a card', () => {
  const withDemo = readdirSync(join(root, 'packages/components')).flatMap((name) => {
    const src = join(root, 'packages/components', name, 'src');
    return existsSync(src) ? readdirSync(src).filter((folder) => existsSync(join(src, folder, 'demo.ts'))).map(() => name) : [];
  });
  assert.ok(withDemo.length >= 9, `positive control: the scan finds the demos (found ${withDemo.length})`);
  assert.deepEqual(demos.map(({ name }) => name), [...withDemo].sort());
  assert.deepEqual(
    demos.filter(({ name }) => name === 'checkbox').map(({ id }) => id),
    ['checkbox', 'switch'],
    'CONTROL: the two-tag package has a plate per tag',
  );
  assert.equal(new Set(demos.map(({ id }) => id)).size, demos.length, 'every plate has its own anchor');
  for (const { id, demo } of demos) {
    const name = id;
    const at = html.indexOf(`<section class="plate" id="${id}">`);
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

test('a state that wires modules is framed, each module mapped, and its frame wires it before its components load', () => {
  const { imports } = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1]);
  const wiring = demos.flatMap(({ demo }) => demo.states.filter((state) => state.wires?.length));
  assert.ok(wiring.length >= 1, 'positive control: a state wires a module (input: the stepper)');
  for (const state of wiring) {
    for (const [i, { from, name }] of state.wires.entries()) {
      assert.ok(imports[from], `${from} is mapped (no import of a component's main entry reaches it)`);
      /** The frame's document is in srcdoc, escaped: its wiring reads with &quot; for each quote. */
      const call = `const{${name}:w${i}}=await import(&quot;${from}&quot;);wire([w${i}]);`;
      const frame = html.slice(html.indexOf(`<iframe class="frame" title="${state.title}"`));
      assert.ok(frame.length > 0 && frame.indexOf(call) !== -1 && frame.indexOf(call) < frame.indexOf("await import('@vera-components/"), `${state.title}: framed, wiring ${from} before its components`);
    }
  }
});

test('no template marker is left, and the page loads the components it shows', () => {
  assert.doesNotMatch(html, /<!--(GENERATED|IMPORTMAP|NAV|COUNT|FIRST|PLATES)-->|\/\*(WIRING|COMPONENTS)\*\//);
  assert.ok(html.includes(JSON.stringify([...new Set(demos.map(({ name }) => name))])), 'the loader list is the packages of the plates, each once');
});
