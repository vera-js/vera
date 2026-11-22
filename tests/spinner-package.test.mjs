/**
 * **@vera-components/spinner: its two entries, as a page and a server meet them** (written by `scripts/new-package.mjs`). `.` registers
 * <vera-spinner> once however many copies load, and development says so once; `./element` registers nothing at import, and
 * its `defineAs` registers under the caller's tag; a server importing `.` through `@verajs/ssr` renders it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { distUrl, isProduction, load } from './dist.mjs';

const TAG = 'vera-spinner';
const SCENARIO = process.env.VERA_PACKAGE_SCENARIO;

if (SCENARIO === 'ssr') {
  const { renderToString } = await import('@verajs/ssr');
  const { html, styles } = await renderToString(distUrl('vera-components/spinner'), { tag: TAG, attributes: { label: 'Loading' } });
  process.stdout.write(JSON.stringify({ html, styles }));
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
    const a = await load('vera-components/spinner', '?copy=a');
    const b = await load('vera-components/spinner', '?copy=b');
    out.one = typeof a.element === 'function' && a.element === b.element && a.element === customElements.get(TAG);
  } else if (SCENARIO === 'element') {
    out.exports = Object.keys(await load('vera-components/spinner/element')).sort();
    out.untouched = customElements.get(TAG) === undefined;
  } else if (SCENARIO === 'define-as') {
    const { defineAs } = await load('vera-components/spinner/element');
    const Class = defineAs('my-spinner');
    out.registered = typeof Class === 'function' && customElements.get('my-spinner') === Class;
    out.untouched = customElements.get(TAG) === undefined;
    const element = document.createElement('my-spinner');
    element.setAttribute('label', 'Loading');
    document.body.append(element);
    flush();
    await Promise.resolve();
    out.rendered = element.querySelector('[data-vera-part="arc"]') !== null;
  } else if (SCENARIO === 'surface') {
    const { element: Class } = await load('vera-components/spinner');
    const element = document.createElement(TAG);
    element.setAttribute('label', 'Loading');
    document.body.append(element);
    /** The parts each state renders. `flush()` drains the scheduler synchronously, so each read sees that state's render. */
    const parts = () => [...new Set([...element.querySelectorAll('[data-vera-part]')].map((node) => node.getAttribute('data-vera-part')))].sort();
    flush();
    out.states = { 'at rest': parts() };
    element.setAttribute('show-label', '');
    flush();
    out.states['with show-label'] = parts();
    /** A part that renders only in some state (open, invalid, with a value) is reached here: drive the state, flush, read. */
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

  test('dist/preupgrade.css is the pre-upgrade rule sheet.ts builds, written by the build, never a committed twin', async () => {
    const { PREUPGRADE } = await import('../packages/components/spinner/src/spinner/sheet.ts');
    const written = readFileSync(new URL('../packages/components/spinner/dist/preupgrade.css', import.meta.url), 'utf8');
    assert.ok(PREUPGRADE.startsWith('@layer vera{') && PREUPGRADE.includes(':not(:defined):empty'), 'CONTROL: the rule is the pre-upgrade one');
    assert.equal(written, PREUPGRADE);
    const pkg = JSON.parse(readFileSync(new URL('../packages/components/spinner/package.json', import.meta.url), 'utf8'));
    assert.equal(pkg.exports['./preupgrade.css'], './dist/preupgrade.css');
  });

  test('a client never declares styles (core would warn at every connect on a page that never wired them)', async () => {
    const { said } = run('surface');
    assert.deepEqual(said, []);
  });

  test('defineAs registers under the caller\'s tag, and the element renders its part', () => {
    const { registered, untouched, rendered, said } = run('define-as');
    assert.equal(registered, true, 'the returned class serves the tag');
    assert.equal(untouched, true, `<${TAG}> stays free`);
    assert.equal(rendered, true, 'the arc part is in the element');
    assert.deepEqual(said, []);
  });

  /**
   * **The surface stays true** (the drift row): every part any driven state renders is declared in `surface.ts`,
   * every declared part renders in some state, and every attribute the element observes is declared, so a name added
   * to the element and not to its surface is red here, in the change that made it. An attribute read only at use
   * (`getAttribute`) is declared and never observed, which is not drift.
   */
  test('every part the element renders is declared and every declared part renders; no attribute it observes is undeclared', async () => {
    const { spinnerSurface } = await import('../packages/components/spinner/src/spinner/surface.ts');
    const { states, observed, said } = run('surface');
    const parts = spinnerSurface.parts.map((part) => part.name);
    const rendered = [...new Set(Object.values(states).flat())].sort();
    assert.ok(rendered.length > 0, 'CONTROL: the element rendered a part');
    for (const [state, names] of Object.entries(states))
      assert.deepEqual(names.filter((name) => !parts.includes(name)), [], `a part rendered ${state} and not declared: add it to surface.ts with the element`);
    assert.deepEqual(parts.filter((name) => !rendered.includes(name)), [], 'a part declared and rendered in no state the scenario drives: drive that state, or remove the part');
    /** One way only: an attribute read at connect (`getAttribute`) is declared and never observed, which is not drift. */
    const declared = spinnerSurface.attributes.map((attribute) => attribute.name);
    assert.deepEqual(observed.filter((name) => !declared.includes(name)), [], 'an attribute observed and not declared: add it to surface.ts with the element');
    assert.deepEqual(said, []);
  });

  test('a server imports "." through @verajs/ssr and renders the element', () => {
    const { html, styles } = run('ssr');
    /** The arc's rule reaches the page only through the server's styles, so served markup turns before any script. */
    assert.ok(styles.includes('[data-vera-part="arc"]') && styles.includes('@keyframes vera-spinner-turn'), styles);
    assert.ok(html.includes(`<${TAG}`), html);
    assert.ok(html.includes('data-vera-part="arc"'), html);
  });
}
