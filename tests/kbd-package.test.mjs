/**
 * **@vera-components/kbd: its two entries, as a page and a server meet them** (written by `scripts/new-package.mjs`). `.` registers
 * <vera-kbd> once however many copies load, and development says so once; `./element` registers nothing at import, and
 * its `defineAs` registers under the caller's tag; a server importing `.` through `@verajs/ssr` renders it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { distUrl, isProduction, load } from './dist.mjs';

const TAG = 'vera-kbd';
const SCENARIO = process.env.VERA_PACKAGE_SCENARIO;

if (SCENARIO === 'ssr') {
  const { renderToString } = await import('@verajs/ssr');
  const { html } = await renderToString(distUrl('vera-components/kbd'), { tag: TAG, attributes: { keys: 'Mod+Shift+K', platform: 'apple' } });
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
    const a = await load('vera-components/kbd', '?copy=a');
    const b = await load('vera-components/kbd', '?copy=b');
    out.one = typeof a.element === 'function' && a.element === b.element && a.element === customElements.get(TAG);
  } else if (SCENARIO === 'element') {
    out.exports = Object.keys(await load('vera-components/kbd/element')).sort();
    out.untouched = customElements.get(TAG) === undefined;
  } else if (SCENARIO === 'define-as') {
    const { defineAs } = await load('vera-components/kbd/element');
    const Class = defineAs('my-kbd');
    out.registered = typeof Class === 'function' && customElements.get('my-kbd') === Class;
    out.untouched = customElements.get(TAG) === undefined;
    const element = document.createElement('my-kbd');
    element.setAttribute('keys', 'Mod+K');
    document.body.append(element);
    flush();
    await Promise.resolve();
    out.rendered = element.querySelectorAll('[data-vera-part="combo"] > [data-vera-part="key"]').length === 2;
  } else if (SCENARIO === 'hydrate') {
    Object.defineProperty(dom.window.navigator, 'platform', { configurable: true, get: () => 'MacIntel' });
    document.body.innerHTML = process.env.VERA_KBD_SERVER_HTML;
    const element = document.querySelector(TAG);
    out.server = element.textContent;
    /**
     * Batches that change what the reader sees: a text change, or an element added or removed. Hydration attaching to
     * the server's markup adds only its comment anchors and empty text nodes, which change nothing shown (counted apart, as a control).
     */
    let batches = 0;
    let anchorsOnly = 0;
    const visible = (node) => node.nodeType === 1 || (node.nodeType === 3 && node.data !== '');
    new MutationObserver((records) => {
      const changes = records.some((r) => r.type === 'characterData' || [...r.addedNodes, ...r.removedNodes].some(visible));
      if (changes) batches++;
      else anchorsOnly++;
    }).observe(element, { subtree: true, childList: true, characterData: true, attributes: true });
    await load('vera-components/kbd');
    flush();
    await Promise.resolve();
    flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    out.client = element.textContent;
    out.afterUpgrade = batches;
    out.anchorsOnly = anchorsOnly;
    flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    out.settled = batches;
  } else if (SCENARIO === 'surface') {
    const { element: Class } = await load('vera-components/kbd');
    const element = document.createElement(TAG);
    element.setAttribute('keys', 'Mod+Shift+K');
    element.setAttribute('platform', 'other');
    document.body.append(element);
    /** The parts each state renders. `flush()` drains the scheduler synchronously, so each read sees that state's render. */
    const parts = () => [...new Set([...element.querySelectorAll('[data-vera-part]')].map((node) => node.getAttribute('data-vera-part')))].sort();
    flush();
    out.states = { 'words (other)': parts() };
    element.setAttribute('platform', 'apple');
    flush();
    out.states['symbols (apple)'] = parts();
    out.words = [...element.querySelectorAll('[data-vera-word]')].map((node) => node.getAttribute('data-vera-word'));
    /** A part that renders only in some state (open, invalid, with a value) is reached here: drive the state, flush, read. */
    out.observed = [...(Class.observedAttributes ?? [])].sort();
  }
  process.stdout.write(JSON.stringify(out));
} else {
  const run = (scenario, extra = {}) => {
    const result = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], {
      encoding: 'utf8',
      env: { ...process.env, VERA_PACKAGE_SCENARIO: scenario, ...extra },
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

  test('"./element" registers nothing at import, and exports defineAs and the two pure spelling functions', () => {
    const { exports, untouched, said } = run('element');
    assert.deepEqual(exports, ['defineAs', 'platformOf', 'spellKeys']);
    assert.equal(untouched, true, `<${TAG}> stays free`);
    assert.deepEqual(said, []);
  });

  test('defineAs registers under the caller\'s tag, and the element renders its part', () => {
    const { registered, untouched, rendered, said } = run('define-as');
    assert.equal(registered, true, 'the returned class serves the tag');
    assert.equal(untouched, true, `<${TAG}> stays free`);
    assert.equal(rendered, true, 'two key parts inside the combo part');
    assert.deepEqual(said, []);
  });

  /**
   * **The surface stays true** (the drift row): every part any driven state renders is declared in `surface.ts`,
   * every declared part renders in some state, and every attribute the element observes is declared, so a name added
   * to the element and not to its surface is red here, in the change that made it. An attribute read only at use
   * (`getAttribute`) is declared and never observed, which is not drift.
   */
  test('every part the element renders is declared and every declared part renders; no attribute it observes is undeclared', async () => {
    const { kbdSurface } = await import('../packages/components/kbd/src/kbd/surface.ts');
    const { states, observed, words, said } = run('surface');
    assert.deepEqual(words, ['Shift', 'Command'], 'CONTROL: the apple state rendered its symbol keys');
    const parts = kbdSurface.parts.map((part) => part.name);
    const rendered = [...new Set(Object.values(states).flat())].sort();
    assert.ok(rendered.length > 0, 'CONTROL: the element rendered a part');
    for (const [state, names] of Object.entries(states))
      assert.deepEqual(names.filter((name) => !parts.includes(name)), [], `a part rendered ${state} and not declared: add it to surface.ts with the element`);
    assert.deepEqual(parts.filter((name) => !rendered.includes(name)), [], 'a part declared and rendered in no state the scenario drives: drive that state, or remove the part');
    /** One way only: an attribute read at connect (`getAttribute`) is declared and never observed, which is not drift. */
    const declared = kbdSurface.attributes.map((attribute) => attribute.name);
    assert.deepEqual(observed.filter((name) => !declared.includes(name)), [], 'an attribute observed and not declared: add it to surface.ts with the element');
    assert.deepEqual(said, []);
  });

  test('a server imports "." through @verajs/ssr and renders the element', () => {
    const { html } = run('ssr');
    assert.ok(html.includes(`<${TAG}`), html);
    assert.ok(html.includes('data-vera-part="combo"') && html.includes('data-vera-part="key"'), html);
    /** The server never renders Apple's symbols, even asked for them: words, which need no rule to be spoken. */
    assert.ok(html.includes('>Ctrl<') && html.includes('>Shift<') && html.includes('>K<'), html);
    assert.ok(!html.includes('⌘') && !html.includes('data-vera-word'), html);
  });

  /** The server's words become Apple's symbols on a Mac reader in ONE render, and nothing changes after it. */
  test('a server render asked for apple hydrates on a Mac reader: words, then one re-spell to symbols', () => {
    const { html } = run('ssr');
    const { server, client, afterUpgrade, anchorsOnly, settled, said } = run('hydrate', { VERA_KBD_SERVER_HTML: html });
    assert.equal(server, 'Ctrl+Shift+K', 'CONTROL: the server rendered words');
    assert.equal(client, '⇧⌘K');
    assert.equal(anchorsOnly, 1, 'CONTROL: hydration attached to the server markup, adding only its anchors');
    assert.equal(afterUpgrade, 1, 'one batch of visible changes: the re-spell');
    assert.equal(settled, afterUpgrade, 'nothing after it');
    assert.deepEqual(said, []);
  });
}
