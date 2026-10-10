/**
 * **The shim's platform imitations ARE the platform's — by error class and name, never by words** (code-system phase
 * 4c, vera-5a, 2026-10-09). Twelve of @verajs/ssr's throws imitate an error the browser itself throws (`Failed to
 * execute 'appendChild' on 'Node'…`, `Illegal constructor`…) and stay off the code system on purpose: the shim is a
 * DOM, and a DOM that answers differently from the browser is the worst bug this package has. "Platform-exact" is
 * otherwise an unchecked label, so each operation runs against the shim AND against jsdom, and the thrown
 * constructor's name and `error.name` must agree. Engines word these differently, so the words are not compared.
 *
 * Where jsdom lacks the API (`moveBefore`, constructable `adoptedStyleSheets`), the spec's answer — a TypeError — is
 * asserted instead, and said so. The thirteenth, `reportError`, is a polyfill that forwards an error, not a throw.
 *
 * The operands are the ones each imitation covers (`null`). Found writing this, and NOT pinned here (a finding of its
 * own, 2026-10-09): the shim accepts a plain object where every engine throws a TypeError — `appendChild({})`,
 * `insertBefore({})`, `replaceChild({})`, `moveBefore({})` — and a bare `new HTMLElement()`. Its guards refuse only
 * null and non-objects.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import '@verajs/ssr';

const shim = globalThis;
const jsdom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true }).window;

/** What an operation throws: [constructor name, error.name], or 'none'. */
const thrown = (run) => {
  try {
    run();
  } catch (error) {
    return [error?.constructor?.name, error?.name];
  }
  return 'none';
};

/** [the platform operation, run against an environment] — each the shim imitates by its own throw. */
const BOTH = [
  ['DOMTokenList.supports() with no supported tokens', (w) => w.document.createElement('div').classList.supports('x')],
  ['customElements.define with a non-constructor', (w) => w.customElements.define('not-a-ctor', 42)],
  ['NodeFilter called as a constructor', (w) => new w.NodeFilter()],
  ['requestAnimationFrame with a non-function', (w) => w.requestAnimationFrame(42)],
  ['appendChild with null', (w) => w.document.createElement('div').appendChild(null)],
  ['insertBefore with null', (w) => w.document.createElement('div').insertBefore(null, null)],
  ['replaceChild with null', (w) => {
    const parent = w.document.createElement('div');
    const child = parent.appendChild(w.document.createElement('i'));
    parent.replaceChild(null, child);
  }],
  ['attachShadow with no mode', (w) => w.document.createElement('div').attachShadow({})],
  ['dispatchEvent with a non-event', (w) => w.document.createElement('div').dispatchEvent({})],
];

for (const [name, run] of BOTH)
  test(`${name}: the shim throws what jsdom throws`, () => {
    const platform = thrown(() => run(jsdom));
    assert.notEqual(platform, 'none', 'CONTROL: the platform refuses it');
    assert.deepEqual(thrown(() => run(shim)), platform);
  });

/** Not in jsdom: the spec's answer, a TypeError. */
const SPEC_ONLY = [
  ['moveBefore with null', () => shim.document.createElement('div').moveBefore(null, null)],
  ['adoptedStyleSheets set to a non-sheet', () => { shim.document.adoptedStyleSheets = [{}]; }],
  ['adoptedStyleSheets set to a non-sequence', () => { shim.document.adoptedStyleSheets = 5; }],
];
for (const [name, run] of SPEC_ONLY)
  test(`${name}: the spec's TypeError (jsdom has no ${name.split(' ')[0]})`, () => {
    assert.deepEqual(thrown(run), ['TypeError', 'TypeError']);
  });
