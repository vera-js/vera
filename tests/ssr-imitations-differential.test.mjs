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
 * The operands now include the plain object (`{}`): the shim once refused only null and non-objects, and accepted
 * `appendChild({})` where every engine throws (found writing this, 2026-10-09; fixed with the Node base below).
 *
 * **The Node interface at the WebIDL boundary** (2026-10-09, the second table): every Node-typed parameter given a
 * non-node, the nullable ones given `null` and `undefined`, the `(Node or DOMString)` variadics given an object, the
 * constructors, the interface objects and what `String(node)` says — each run on both, with the WHOLE outcome compared
 * (the error's class and name, or the value returned). A differential found 18 of 22 such rows differing; this is the
 * net that keeps them equal. Per-tag element names (`[object HTMLDivElement]`) are not here: they need a measured
 * tag-to-interface table, open as its own item.
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
  ['appendChild with a plain object', (w) => w.document.createElement('div').appendChild({})],
  ['insertBefore with a plain object', (w) => w.document.createElement('div').insertBefore({}, null)],
  ['replaceChild with a plain object', (w) => {
    const parent = w.document.createElement('div');
    const child = parent.appendChild(w.document.createElement('i'));
    parent.replaceChild({}, child);
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
  ['moveBefore with a plain object', () => shim.document.createElement('div').moveBefore({}, null)],
  ['adoptedStyleSheets set to a non-sheet', () => { shim.document.adoptedStyleSheets = [{}]; }],
  ['adoptedStyleSheets set to a non-sequence', () => { shim.document.adoptedStyleSheets = 5; }],
];
for (const [name, run] of SPEC_ONLY)
  test(`${name}: the spec's TypeError (jsdom has no ${name.split(' ')[0]})`, () => {
    assert.deepEqual(thrown(run), ['TypeError', 'TypeError']);
  });

/** The whole outcome of an operation: `throws <class>/<name>`, or `returns <value>`. */
const outcome = (run) => {
  try {
    return `returns ${String(run())}`;
  } catch (error) {
    return `throws ${error?.constructor?.name}/${error?.name}`;
  }
};
/** A parent holding one `<b>`, made in the environment under test. */
const parent = (w) => {
  const div = w.document.createElement('div');
  div.appendChild(w.document.createElement('b'));
  return div;
};
/** What a parent's children are, as `nodeType:text` — how the variadics' conversion shows. */
const kids = (node) => [...node.childNodes].map((child) => `${child.nodeType}:${child.textContent}`).join(',');
let names = 0;
/** A fresh custom-element name per environment run, so `define` never collides. */
const fresh = () => `idl-probe-${++names}`;

const IDL = [
  ['insertBefore(node, {})', (w) => parent(w).insertBefore(w.document.createElement('i'), {})],
  ['insertBefore(node, undefined)', (w) => parent(w).insertBefore(w.document.createElement('i'), undefined).localName],
  ['insertBefore(node) — the reference is required', (w) => parent(w).insertBefore(w.document.createElement('i'))],
  ['replaceChild(node, {})', (w) => parent(w).replaceChild(w.document.createElement('i'), {})],
  ['removeChild({})', (w) => parent(w).removeChild({})],
  ['removeChild(null)', (w) => parent(w).removeChild(null)],
  ['contains({})', (w) => parent(w).contains({})],
  ['contains(null)', (w) => parent(w).contains(null)],
  ['contains(undefined)', (w) => parent(w).contains(undefined)],
  ['contains() — the argument is required', (w) => parent(w).contains()],
  ['text.contains({})', (w) => w.document.createTextNode('x').contains({})],
  ['compareDocumentPosition({})', (w) => parent(w).compareDocumentPosition({})],
  ['compareDocumentPosition(null)', (w) => parent(w).compareDocumentPosition(null)],
  ['isSameNode({})', (w) => parent(w).isSameNode({})],
  ['isSameNode(null)', (w) => parent(w).isSameNode(null)],
  ['isSameNode(undefined)', (w) => parent(w).isSameNode(undefined)],
  ['text.isSameNode({})', (w) => w.document.createTextNode('x').isSameNode({})],
  ['isEqualNode({})', (w) => parent(w).isEqualNode({})],
  ['isEqualNode(null)', (w) => parent(w).isEqualNode(null)],
  ['isEqualNode(undefined)', (w) => parent(w).isEqualNode(undefined)],
  ['text.isEqualNode({})', (w) => w.document.createTextNode('x').isEqualNode({})],
  ['append({}) is the text [object Object]', (w) => { const p = parent(w); p.append({}); return kids(p); }],
  ['prepend({})', (w) => { const p = parent(w); p.prepend({}); return kids(p); }],
  ['before({})', (w) => { const p = parent(w); p.firstChild.before({}); return kids(p); }],
  ['after(7)', (w) => { const p = parent(w); p.firstChild.after(7); return kids(p); }],
  ['replaceWith({})', (w) => { const p = parent(w); p.firstChild.replaceWith({}); return kids(p); }],
  ['replaceChildren({}, null)', (w) => { const p = parent(w); p.replaceChildren({}, null); return kids(p); }],
  ['text instanceof Node', (w) => w.document.createTextNode('x') instanceof w.Node],
  ['comment instanceof Node', (w) => w.document.createComment('x') instanceof w.Node],
  ['text instanceof Text, CharacterData', (w) => w.document.createTextNode('x') instanceof w.Text && w.document.createTextNode('x') instanceof w.CharacterData],
  ['comment instanceof Comment', (w) => w.document.createComment('x') instanceof w.Comment],
  ['an element is not CharacterData', (w) => w.document.createElement('i') instanceof w.CharacterData],
  ['text.TEXT_NODE', (w) => w.document.createTextNode('x').TEXT_NODE],
  ['Node.COMMENT_NODE', (w) => w.Node.COMMENT_NODE],
  ['new Node()', (w) => new w.Node()],
  ['new CharacterData()', (w) => new w.CharacterData('x')],
  ["new Text('x')", (w) => new w.Text('x').data],
  ["new Comment('x')", (w) => new w.Comment('x').data],
  ['new HTMLElement()', (w) => new w.HTMLElement()],
  ["new HTMLElement('div')", (w) => new w.HTMLElement('div')],
  ['new X() for a class never defined', (w) => { const X = class extends w.HTMLElement {}; return new X() instanceof X; }],
  ['new X() for a defined class', (w) => { const X = class extends w.HTMLElement {}; w.customElements.define(fresh(), X); return new X() instanceof X; }],
  ['new Y() for an undefined subclass of a defined class', (w) => {
    const X = class extends w.HTMLElement {};
    w.customElements.define(fresh(), X);
    const Y = class extends X {};
    return new Y();
  }],
  ['an element created before its class is defined still works after', (w) => {
    const name = fresh();
    const early = w.document.createElement(name);
    w.customElements.define(name, class extends w.HTMLElement {});
    early.setAttribute('a', '1');
    return early.getAttribute('a');
  }],
  ['new Image() and new Audio()', (w) => `${new w.Image().localName} ${new w.Audio().localName}`],
  ['String(text)', (w) => String(w.document.createTextNode('x'))],
  ['String(comment)', (w) => String(w.document.createComment('x'))],
  ['String(fragment)', (w) => String(w.document.createDocumentFragment())],
  ['String(shadowRoot)', (w) => String(w.document.createElement('div').attachShadow({ mode: 'open' }))],
];

for (const [name, run] of IDL)
  test(`${name}: the shim answers what jsdom answers`, () => {
    const platform = outcome(() => run(jsdom));
    assert.ok(platform.length > 'returns '.length, `CONTROL: the platform answered: ${platform}`);
    assert.equal(outcome(() => run(shim)), platform);
  });

