/**
 * **What the engines answer at the Node interface's WebIDL boundary** — the facts the SSR shim's second differential
 * table (`tests/ssr-imitations-differential.test.mjs`) takes from jsdom. jsdom is the regression net, never the oracle,
 * so the rows that decide the shim's behavior are measured here on Chromium, Firefox and WebKit: a Node-typed parameter
 * given a plain object, the nullable ones given `null`/`undefined`, the `(Node or DOMString)` variadics, the abstract
 * and the custom-element constructors, and what `String(node)` says. `moveBefore` is here alone because jsdom lacks it;
 * where an engine lacks it too, the row says so rather than passing silently.
 */
import { expect } from '@esm-bundle/chai';

/** `throws <class>`, or `returns <value>` — the class only, as engines word their messages differently. */
const outcome = (run) => {
  try {
    return `returns ${String(run())}`;
  } catch (error) {
    return `throws ${error.constructor.name}`;
  }
};
const parent = () => {
  const div = document.createElement('div');
  div.appendChild(document.createElement('b'));
  return div;
};
const kids = (node) => [...node.childNodes].map((child) => `${child.nodeType}:${child.textContent}`).join(',');
let names = 0;
const fresh = () => `idl-facts-${++names}`;

const FACTS = [
  ['appendChild({})', () => parent().appendChild({}), 'throws TypeError'],
  ['insertBefore({}, null)', () => parent().insertBefore({}, null), 'throws TypeError'],
  ['insertBefore(node, {})', () => parent().insertBefore(document.createElement('i'), {}), 'throws TypeError'],
  ['insertBefore(node, undefined)', () => parent().insertBefore(document.createElement('i'), undefined).localName, 'returns i'],
  ['insertBefore(node)', () => parent().insertBefore(document.createElement('i')), 'throws TypeError'],
  ['replaceChild({}, child)', () => { const p = parent(); return p.replaceChild({}, p.firstChild); }, 'throws TypeError'],
  ['replaceChild(node, {})', () => parent().replaceChild(document.createElement('i'), {}), 'throws TypeError'],
  ['removeChild({})', () => parent().removeChild({}), 'throws TypeError'],
  ['removeChild(null)', () => parent().removeChild(null), 'throws TypeError'],
  ['contains({})', () => parent().contains({}), 'throws TypeError'],
  ['contains(null)', () => parent().contains(null), 'returns false'],
  ['contains(undefined)', () => parent().contains(undefined), 'returns false'],
  ['contains()', () => parent().contains(), 'throws TypeError'],
  ['compareDocumentPosition({})', () => parent().compareDocumentPosition({}), 'throws TypeError'],
  ['isSameNode({})', () => parent().isSameNode({}), 'throws TypeError'],
  ['isSameNode(undefined)', () => parent().isSameNode(undefined), 'returns false'],
  ['isEqualNode({})', () => parent().isEqualNode({}), 'throws TypeError'],
  ['isEqualNode(null)', () => parent().isEqualNode(null), 'returns false'],
  ['append({})', () => { const p = parent(); p.append({}); return kids(p); }, 'returns 1:,3:[object Object]'],
  ['after(7)', () => { const p = parent(); p.firstChild.after(7); return kids(p); }, 'returns 1:,3:7'],
  ['replaceChildren({}, null)', () => { const p = parent(); p.replaceChildren({}, null); return kids(p); }, 'returns 3:[object Object],3:null'],
  ['text instanceof Node', () => document.createTextNode('x') instanceof Node, 'returns true'],
  ['new Node()', () => new Node(), 'throws TypeError'],
  ['new CharacterData()', () => new CharacterData('x'), 'throws TypeError'],
  ["new Text('x')", () => new Text('x').data, 'returns x'],
  ['new HTMLElement()', () => new HTMLElement(), 'throws TypeError'],
  ["new HTMLElement('div')", () => new HTMLElement('div'), 'throws TypeError'],
  ['new X() for a class never defined', () => { const X = class extends HTMLElement {}; return new X(); }, 'throws TypeError'],
  ['new X() for a defined class', () => { const X = class extends HTMLElement {}; customElements.define(fresh(), X); return new X() instanceof X; }, 'returns true'],
  ['new Y() for an undefined subclass of a defined class', () => {
    const X = class extends HTMLElement {};
    customElements.define(fresh(), X);
    const Y = class extends X {};
    return new Y();
  }, 'throws TypeError'],
  ['String(text)', () => String(document.createTextNode('x')), 'returns [object Text]'],
  ['String(comment)', () => String(document.createComment('x')), 'returns [object Comment]'],
  ['String(fragment)', () => String(document.createDocumentFragment()), 'returns [object DocumentFragment]'],
  ['String(shadowRoot)', () => String(document.createElement('div').attachShadow({ mode: 'open' })), 'returns [object ShadowRoot]'],
];

it('answers each Node-interface fact as the shim imitates it', () => {
  const wrong = FACTS.map(([label, run, expected]) => [label, outcome(run), expected]).filter(([, got, expected]) => got !== expected);
  expect(wrong.map(([label, got, expected]) => `${label}: ${got}, expected ${expected}`)).to.deep.equal([]);
});

it('refuses moveBefore({}) with a TypeError where the engine has moveBefore', () => {
  const div = parent();
  if (typeof div.moveBefore !== 'function') return; // this engine has no moveBefore: nothing to measure
  expect(outcome(() => div.moveBefore({}, null))).to.equal('throws TypeError');
});
