/**
 * **@vera-components/icon: its two entries, as a page and a server meet them** (written by `scripts/new-package.mjs`). `.` registers
 * <vera-icon> once however many copies load, and development says so once; `./element` registers nothing at import, and
 * its `defineAs` registers under the caller's tag; a server importing `.` through `@verajs/ssr` renders it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { distUrl, isProduction, load } from './dist.mjs';

const TAG = 'vera-icon';
const SCENARIO = process.env.VERA_PACKAGE_SCENARIO;

if (SCENARIO === 'ssr') {
  const { renderToString } = await import('@verajs/ssr');
  const { html } = await renderToString(distUrl('vera-components/icon'), { tag: TAG, attributes: { src: '/sprite.svg#check', label: 'Done' }, location: 'http://localhost/' });
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
  if (SCENARIO === 'twice') {
    const a = await load('vera-components/icon', '?copy=a');
    const b = await load('vera-components/icon', '?copy=b');
    out.one = typeof a.element === 'function' && a.element === b.element && a.element === customElements.get(TAG);
  } else if (SCENARIO === 'element') {
    out.exports = Object.keys(await load('vera-components/icon/element')).sort();
    out.untouched = customElements.get(TAG) === undefined;
  } else if (SCENARIO === 'define-as') {
    const { defineAs } = await load('vera-components/icon/element');
    const Class = defineAs('my-icon');
    out.registered = typeof Class === 'function' && customElements.get('my-icon') === Class;
    out.untouched = customElements.get(TAG) === undefined;
    const element = document.createElement('my-icon');
    element.setAttribute('src', '/sprite.svg#check');
    document.body.append(element);
    flush();
    await Promise.resolve();
    out.rendered = element.querySelector('svg[data-vera-part="svg"] > use') !== null;
  } else if (SCENARIO === 'surface') {
    const { element: Class } = await load('vera-components/icon');
    const element = document.createElement(TAG);
    document.body.append(element);
    /** The parts each state renders. `flush()` drains the scheduler synchronously, so each read sees that state's render. */
    const parts = () => [...new Set([...element.querySelectorAll('[data-vera-part]')].map((node) => node.getAttribute('data-vera-part')))].sort();
    flush();
    out.states = { 'at rest': parts() };
    element.setAttribute('src', '/sprite.svg#check');
    flush();
    out.states['with a same-origin src'] = parts();
    element.setAttribute('label', 'Done');
    flush();
    out.states['labeled, with a src'] = parts();
    out.observed = [...(Class.observedAttributes ?? [])].sort();
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

  test('two copies of "." register one class, and development says defined-twice once', () => {
    const { one, said } = run('twice');
    assert.equal(one, true, 'both copies export the registered class');
    const lines = said.filter((line) => line.includes('defined-twice'));
    assert.equal(lines.length, isProduction ? 0 : 1, said.join(' | '));
    assert.deepEqual(said.filter((line) => !line.includes('defined-twice')), [], 'nothing else is said');
    if (!isProduction) assert.match(lines[0], /^\[vera\] /);
  });

  test('"./element" registers nothing at import, and exports only defineAs', () => {
    const { exports, untouched, said } = run('element');
    assert.deepEqual(exports, ['defineAs']);
    assert.equal(untouched, true, `<${TAG}> stays free`);
    assert.deepEqual(said, []);
  });

  test('defineAs registers under the caller\'s tag, and the element renders its svg part from src', () => {
    const { registered, untouched, rendered, said } = run('define-as');
    assert.equal(registered, true, 'the returned class serves the tag');
    assert.equal(untouched, true, `<${TAG}> stays free`);
    assert.equal(rendered, true, 'the svg part, with its use, is in the element');
    assert.deepEqual(said, []);
  });

  /**
   * **The surface stays true** (the drift row): every part any driven state renders is declared in `surface.ts`,
   * every declared part renders in some state, and every attribute the element observes is declared, so a name added
   * to the element and not to its surface is red here, in the change that made it.
   */
  test('every part the element renders is declared and every declared part renders; no attribute it observes is undeclared', async () => {
    const { iconSurface } = await import('../packages/components/icon/src/icon/surface.ts');
    const { states, observed, said } = run('surface');
    const parts = iconSurface.parts.map((part) => part.name);
    const rendered = [...new Set(Object.values(states).flat())].sort();
    assert.ok(rendered.length > 0, 'CONTROL: the element rendered a part');
    assert.deepEqual(states['at rest'], [], 'with no src the icon renders no part of its own');
    for (const [state, names] of Object.entries(states))
      assert.deepEqual(names.filter((name) => !parts.includes(name)), [], `a part rendered ${state} and not declared: add it to surface.ts with the element`);
    assert.deepEqual(parts.filter((name) => !rendered.includes(name)), [], 'a part declared and rendered in no state the scenario drives: drive that state, or remove the part');
    const declared = iconSurface.attributes.map((attribute) => attribute.name);
    assert.deepEqual(observed, ['label', 'src'], 'CONTROL: both attributes are observed');
    assert.deepEqual(observed.filter((name) => !declared.includes(name)), [], 'an attribute observed and not declared: add it to surface.ts with the element');
    assert.deepEqual(said, []);
  });

  test('a server imports "." through @verajs/ssr and renders the element', () => {
    const { html } = run('ssr');
    assert.ok(html.includes(`<${TAG}`), html);
    assert.ok(html.includes('data-vera-part="svg"') && html.includes('href="/sprite.svg#check"'), html);
    assert.ok(html.includes('role="img"') && html.includes('aria-label="Done"'), html);
  });
}
