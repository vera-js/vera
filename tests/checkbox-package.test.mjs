/**
 * **@vera-components/checkbox: its two entries, as a page and a server meet them.** `.` registers <vera-checkbox> and
 * <vera-switch> once however many copies load, and development says so once per tag; `./element` registers nothing at
 * import, and its `defineAs` and `defineSwitchAs` register under the caller's tags and serve the author's input there;
 * a server importing `.` through `@verajs/ssr` renders the element with the author's markup untouched.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { distUrl, isProduction, load } from './dist.mjs';

const TAGS = ['vera-checkbox', 'vera-switch'];
const SCENARIO = process.env.VERA_PACKAGE_SCENARIO;
const LABELED = '<label><input type="checkbox" name="n"> Label</label>';

if (SCENARIO === 'ssr') {
  const { renderToString } = await import('@verajs/ssr');
  const { html } = await renderToString(distUrl('vera-components/checkbox'), { tag: 'vera-checkbox', children: LABELED });
  process.stdout.write(JSON.stringify({ html }));
} else if (SCENARIO) {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', pretendToBeVisual: true });
  for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'MutationObserver']) globalThis[key] = dom.window[key];
  const said = [];
  console.warn = (...args) => said.push(String(args[0]));
  console.error = (...args) => said.push(String(args[0]));
  const { flush, wire } = await load('core');
  wire([(await load('renderer')).renderer]);
  const out = { said };
  /** Past the development name check's task, so a warning it would print is heard. */
  const settle = async () => {
    flush();
    await Promise.resolve();
    flush();
    await new Promise((resolve) => setTimeout(resolve, 10));
  };
  if (SCENARIO === 'twice') {
    const a = await load('vera-components/checkbox', '?copy=a');
    const b = await load('vera-components/checkbox', '?copy=b');
    out.one =
      typeof a.element === 'function' &&
      a.element === b.element &&
      a.element === customElements.get(TAGS[0]) &&
      typeof a.switchElement === 'function' &&
      a.switchElement === b.switchElement &&
      a.switchElement === customElements.get(TAGS[1]);
  } else if (SCENARIO === 'element') {
    out.exports = Object.keys(await load('vera-components/checkbox/element')).sort();
    out.untouched = TAGS.every((tag) => customElements.get(tag) === undefined);
  } else if (SCENARIO === 'define-as') {
    const { defineAs, defineSwitchAs } = await load('vera-components/checkbox/element');
    const Box = defineAs('my-checkbox');
    const Switch = defineSwitchAs('my-switch');
    out.registered = typeof Box === 'function' && customElements.get('my-checkbox') === Box && customElements.get('my-switch') === Switch;
    out.untouched = TAGS.every((tag) => customElements.get(tag) === undefined);
    document.body.innerHTML = `<my-checkbox>${LABELED}</my-checkbox><my-switch>${LABELED}</my-switch>`;
    await settle();
    const [box, toggle] = document.querySelectorAll('input');
    out.served = box.hasAttribute('data-vera-checkbox') && toggle.hasAttribute('data-vera-switch') && toggle.getAttribute('role') === 'switch';
  } else if (SCENARIO === 'surface') {
    const { element: Box, switchElement: Switch } = await load('vera-components/checkbox');
    document.body.innerHTML = `<vera-checkbox indeterminate>${LABELED}</vera-checkbox><vera-switch>${LABELED}</vera-switch>`;
    await settle();
    out.parts = document.querySelectorAll('[data-vera-part]').length;
    out.served = document.querySelectorAll('input[data-vera-checkbox], input[data-vera-switch]').length;
    out.observed = { 'vera-checkbox': [...(Box.observedAttributes ?? [])].sort(), 'vera-switch': [...(Switch.observedAttributes ?? [])].sort() };
  }
  process.stdout.write(JSON.stringify(out));
} else {
  const run = (scenario) => {
    const result = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], {
      encoding: 'utf8',
      env: { ...process.env, VERA_PACKAGE_SCENARIO: scenario },
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };

  test('two copies of "." register one class per tag, and development says defined-twice once per tag', () => {
    const { one, said } = run('twice');
    assert.equal(one, true, 'both copies export the registered classes');
    const lines = said.filter((line) => line.includes('defined-twice'));
    assert.equal(lines.length, isProduction ? 0 : 2, said.join(' | '));
    assert.deepEqual(said.filter((line) => !line.includes('defined-twice')), [], 'nothing else is said');
    if (!isProduction) {
      for (const line of lines) assert.match(line, /^\[vera\] /);
      for (const tag of TAGS) assert.ok(lines.some((line) => line.includes(`<${tag}>`)), `the warning names <${tag}>`);
    }
  });

  test('"./element" registers nothing at import, and exports only defineAs and defineSwitchAs', () => {
    const { exports, untouched, said } = run('element');
    assert.deepEqual(exports, ['defineAs', 'defineSwitchAs']);
    assert.equal(untouched, true, 'both tags stay free');
    assert.deepEqual(said, []);
  });

  test("defineAs and defineSwitchAs register under the caller's tags, and each serves the author's input there", () => {
    const { registered, untouched, served, said } = run('define-as');
    assert.equal(registered, true, 'the returned classes serve the tags');
    assert.equal(untouched, true, 'both tags stay free');
    assert.equal(served, true, 'each input carries its mark, and the switch its role (jsdom has no native switch)');
    assert.deepEqual(said, []);
  });

  /**
   * **The surface stays true** (the drift row): the elements render no part (the input and its label are the
   * author's), and every attribute each observes is declared in its `surface.ts`, so a name added to the element and
   * not to its surface is red here, in the change that made it.
   */
  test('no part renders, and no attribute either tag observes is undeclared', async () => {
    const { checkboxSurface } = await import('../packages/components/checkbox/src/checkbox/surface.ts');
    const { switchSurface } = await import('../packages/components/checkbox/src/switch/surface.ts');
    const { parts, served, observed, said } = run('surface');
    assert.equal(served, 2, 'CONTROL: both inputs were served');
    assert.equal(parts, 0, 'a part rendered: declare it in surface.ts with the element');
    assert.deepEqual(observed['vera-checkbox'], ['indeterminate'], 'CONTROL: the checkbox observes its one live attribute');
    assert.deepEqual(observed['vera-switch'], [], 'the switch observes none: its look opt-out is read when the input is served');
    for (const surface of [checkboxSurface, switchSurface]) {
      const declared = surface.attributes.map((attribute) => attribute.name);
      assert.deepEqual(observed[surface.tag].filter((name) => !declared.includes(name)), [], `<${surface.tag}> observes an undeclared attribute`);
    }
    assert.deepEqual(said, []);
  });

  test("a server imports \".\" through @verajs/ssr and renders the element around the author's markup", () => {
    const { html } = run('ssr');
    assert.ok(html.includes('<vera-checkbox'), html);
    assert.ok(html.includes('<input type="checkbox" name="n">'), html);
  });
}
