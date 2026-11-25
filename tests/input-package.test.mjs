/**
 * **@vera-components/input: its two entries, as a page and a server meet them** (written by `scripts/new-package.mjs`). `.` registers
 * <vera-input> once however many copies load, and development says so once; `./element` registers nothing at import, and
 * its `defineAs` registers under the caller's tag; a server importing `.` through `@verajs/ssr` renders it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { distUrl, isProduction, load } from './dist.mjs';

const TAG = 'vera-input';
const SCENARIO = process.env.VERA_PACKAGE_SCENARIO;

if (SCENARIO === 'ssr') {
  const { renderToString } = await import('@verajs/ssr');
  const { html } = await renderToString(distUrl('vera-components/input'), {
    tag: TAG,
    attributes: process.env.VERA_INPUT_SSR_ATTRIBUTES ? JSON.parse(process.env.VERA_INPUT_SSR_ATTRIBUTES) : {},
  });
  process.stdout.write(JSON.stringify({ html }));
} else if (SCENARIO) {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', pretendToBeVisual: true });
  for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'MutationObserver']) globalThis[key] = dom.window[key];
  const said = [];
  console.warn = (...args) => said.push(String(args[0]));
  console.error = (...args) => said.push(String(args[0]));
  const { flush, wire } = await load('core');
  wire(SCENARIO === 'hydrate' ? [(await load('renderer')).renderer, (await load('renderer/hydration')).hydration] : [(await load('renderer')).renderer]);
  const out = { said };
  if (SCENARIO === 'twice') {
    const a = await load('vera-components/input', '?copy=a');
    const b = await load('vera-components/input', '?copy=b');
    out.one = typeof a.element === 'function' && a.element === b.element && a.element === customElements.get(TAG);
  } else if (SCENARIO === 'element') {
    out.exports = Object.keys(await load('vera-components/input/element')).sort();
    out.untouched = customElements.get(TAG) === undefined;
  } else if (SCENARIO === 'define-as') {
    const { defineAs } = await load('vera-components/input/element');
    const Class = defineAs('my-input');
    out.registered = typeof Class === 'function' && customElements.get('my-input') === Class;
    out.untouched = customElements.get(TAG) === undefined;
    const element = document.createElement('my-input');
    document.body.append(element);
    flush();
    await Promise.resolve();
    out.rendered = element.querySelector('[data-vera-part="input"]') !== null;
  } else if (SCENARIO === 'hydrate') {
    document.body.innerHTML = `<label>Search ${process.env.VERA_INPUT_SERVER_HTML}</label>`;
    const element = document.querySelector(TAG);
    const served = element.querySelector('input');
    out.served = served !== null && served.getAttribute('data-vera-part') === 'input';
    /** Changes a reader could see: an element added or removed, or text. Hydration's own anchors are counted apart. */
    let batches = 0;
    let anchorsOnly = 0;
    const visible = (node) => node.nodeType === 1 || (node.nodeType === 3 && node.data !== '');
    new MutationObserver((records) => {
      const changes = records.some((r) => r.type === 'characterData' || [...r.addedNodes, ...r.removedNodes].some(visible));
      if (changes) batches++;
      else anchorsOnly++;
    }).observe(element, { subtree: true, childList: true, characterData: true });
    await load('vera-components/input');
    flush();
    await Promise.resolve();
    flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const input = element.querySelector('input');
    out.same = input === served;
    out.inputs = element.querySelectorAll('input').length;
    out.attributes = Object.fromEntries([...input.attributes].map((a) => [a.name, a.value]));
    out.batches = batches;
    out.anchorsOnly = anchorsOnly;
  } else if (SCENARIO === 'surface') {
    const { element: Class } = await load('vera-components/input');
    const element = document.createElement(TAG);
    document.body.append(element);
    /** The parts each state renders. `flush()` drains the scheduler synchronously, so each read sees that state's render. */
    const parts = () => [...new Set([...element.querySelectorAll('[data-vera-part]')].map((node) => node.getAttribute('data-vera-part')))].sort();
    flush();
    out.states = { 'at rest': parts() };
    /** A part that renders only in some state (open, invalid, with a value) is reached here: drive the state, flush, read. */
    element.remove();
    const options = document.createElement(TAG);
    options.setAttribute('clearable', '');
    options.setAttribute('loading', '');
    options.innerHTML = '<span data-vera-part="prefix">$</span><input aria-label="Amount" value="5"><span data-vera-part="suffix">.00</span>';
    document.body.append(options);
    flush();
    await Promise.resolve();
    flush();
    out.states['the user\'s input, prefix and suffix, clearable with a value, loading'] = [...new Set([...options.querySelectorAll('[data-vera-part]')].map((node) => node.getAttribute('data-vera-part')))].sort();
    const secret = document.createElement(TAG);
    secret.setAttribute('reveal', '');
    secret.setAttribute('caps-lock-hint', '');
    secret.innerHTML = '<input aria-label="Password" type="password">';
    document.body.append(secret);
    flush();
    await Promise.resolve();
    flush();
    out.states['a password input with reveal and caps-lock-hint'] = [...new Set([...secret.querySelectorAll('[data-vera-part]')].map((node) => node.getAttribute('data-vera-part')))].sort();
    /** The stepper's parts render only with its module wired: wired here, before the number input is served. */
    wire([(await load('vera-components/input/stepper')).stepper]);
    const number = document.createElement(TAG);
    number.innerHTML = '<input aria-label="Quantity" type="number">';
    document.body.append(number);
    flush();
    await Promise.resolve();
    flush();
    out.states['a number input'] = [...new Set([...number.querySelectorAll('[data-vera-part]')].map((node) => node.getAttribute('data-vera-part')))].sort();
    out.observed = [...(Class.observedAttributes ?? [])].sort();
  }
  process.stdout.write(JSON.stringify(out));
} else {
  const run = (scenario, extra = {}) => {
    const result = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], {
      encoding: 'utf8',
      env: { ...process.env, ...extra, VERA_PACKAGE_SCENARIO: scenario },
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

  test('defineAs registers under the caller\'s tag, and the element renders its part', () => {
    const { registered, untouched, rendered, said } = run('define-as');
    assert.equal(registered, true, 'the returned class serves the tag');
    assert.equal(untouched, true, `<${TAG}> stays free`);
    assert.equal(rendered, true, 'the default input part is in the element');
    assert.deepEqual(said, []);
  });

  /**
   * **The surface stays true** (the drift row): every part any driven state renders is declared in `surface.ts`,
   * every declared part renders in some state, and every attribute the element observes is declared, so a name added
   * to the element and not to its surface is red here, in the change that made it. An attribute read only at use
   * (`getAttribute`) is declared and never observed, which is not drift.
   */
  test('every part the element renders is declared and every declared part renders; no attribute it observes is undeclared', async () => {
    const { inputSurface } = await import('../packages/components/input/src/input/surface.ts');
    const { states, observed, said } = run('surface');
    const parts = inputSurface.parts.map((part) => part.name);
    const rendered = [...new Set(Object.values(states).flat())].sort();
    assert.ok(rendered.length > 0, 'CONTROL: the element rendered a part');
    for (const [state, names] of Object.entries(states))
      assert.deepEqual(names.filter((name) => !parts.includes(name)), [], `a part rendered ${state} and not declared: add it to surface.ts with the element`);
    assert.deepEqual(parts.filter((name) => !rendered.includes(name)), [], 'a part declared and rendered in no state the scenario drives: drive that state, or remove the part');
    /** One way only: an attribute read at connect (`getAttribute`) is declared and never observed, which is not drift. */
    const declared = inputSurface.attributes.map((attribute) => attribute.name);
    assert.deepEqual(observed.filter((name) => !declared.includes(name)), [], 'an attribute observed and not declared: add it to surface.ts with the element');
    assert.deepEqual(said, []);
  });

  /** The server's default input is the one the client keeps: hydration attaches to it, never renders a second. */
  test('a server-rendered default input hydrates in place: the same element, its attributes, nothing visible changed', () => {
    const attributes = { name: 'q', type: 'search', placeholder: 'Find', value: 'vera', autocomplete: 'off' };
    const { html } = run('ssr', { VERA_INPUT_SSR_ATTRIBUTES: JSON.stringify(attributes) });
    assert.ok(html.includes('data-vera-part="input"') && html.includes('placeholder="Find"'), html);
    const { served, same, inputs, attributes: kept, batches, said } = run('hydrate', { VERA_INPUT_SERVER_HTML: html });
    assert.equal(served, true, 'CONTROL: the server rendered the default input');
    assert.equal(same, true, 'the served input is kept, not replaced');
    assert.equal(inputs, 1, 'never a second input');
    for (const [name, value] of Object.entries(attributes)) assert.equal(kept[name], value, name);
    assert.equal(batches, 0, 'no visible change at hydration');
    assert.deepEqual(said, [], 'no hydration mismatch, no warning');
  });

  test('a server imports "." through @verajs/ssr and renders the element', () => {
    const { html } = run('ssr');
    assert.ok(html.includes(`<${TAG}`), html);
    assert.ok(html.includes('data-vera-part="input"'), html);
  });
}
