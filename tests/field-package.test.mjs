/**
 * **@vera-components/field: its two entries, as a page and a server meet them** (written by `scripts/new-package.mjs`). `.` registers
 * <vera-field> once however many copies load, and development says so once; `./element` registers nothing at import, and
 * its `defineAs` registers under the caller's tag; a server importing `.` through `@verajs/ssr` renders it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { distUrl, isProduction, load } from './dist.mjs';

const TAG = 'vera-field';
const SCENARIO = process.env.VERA_PACKAGE_SCENARIO;

if (SCENARIO === 'ssr') {
  const { renderToString } = await import('@verajs/ssr');
  const { html } = await renderToString(distUrl('vera-components/field'), { tag: TAG });
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
    const a = await load('vera-components/field', '?copy=a');
    const b = await load('vera-components/field', '?copy=b');
    out.one = typeof a.element === 'function' && a.element === b.element && a.element === customElements.get(TAG);
  } else if (SCENARIO === 'element') {
    out.exports = Object.keys(await load('vera-components/field/element')).sort();
    out.untouched = customElements.get(TAG) === undefined;
  } else if (SCENARIO === 'define-as') {
    const { defineAs } = await load('vera-components/field/element');
    const Class = defineAs('my-field');
    out.registered = typeof Class === 'function' && customElements.get('my-field') === Class;
    out.untouched = customElements.get(TAG) === undefined;
    const element = document.createElement('my-field');
    element.innerHTML = '<label>A</label><input>';
    document.body.append(element);
    flush();
    await Promise.resolve();
    /** The field renders nothing of its own: it wires the user's children where they are. */
    out.rendered = element.querySelector('label').htmlFor === element.querySelector('input').id && element.children.length === 2;
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

  test('defineAs registers under the caller\'s tag, and the element wires its children', () => {
    const { registered, untouched, rendered, said } = run('define-as');
    assert.equal(registered, true, 'the returned class serves the tag');
    assert.equal(untouched, true, `<${TAG}> stays free`);
    assert.equal(rendered, true, 'the label names the control, and nothing was added');
    assert.deepEqual(said, []);
  });

  test('a server imports "." through @verajs/ssr and renders the element, with no markup of its own', () => {
    const { html } = run('ssr');
    assert.ok(html.includes(`<${TAG}`), html);
    assert.ok(!html.includes('data-vera-part'), html);
  });
}
