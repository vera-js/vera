/**
 * **The tree the author wrote, against the tree the browser builds.**
 *
 * Every other suite here compares one spelling to another spelling. This compares markup to
 * MEANING: for each case, the same tree is turned into JSX source *and* built node-by-node with
 * `createElement`, and the two must produce the same DOM. `createElement` cannot be reshaped by a
 * parser — it is the tree, literally — so it is the oracle for what the author described.
 *
 * **Nothing here is a hand-written expectation, and that is the entire point.** The suite this one
 * generalises, `./jsx-equivalence.test.mjs`, wrote `<my-comp />` on BOTH sides of five of its own
 * pairs: it compared a defect with itself and passed for as long as the defect lived. An
 * expectation typed by someone holding a misconception encodes the misconception. Here both sides
 * are generated from one source, so no misconception has anywhere to hide.
 *
 * The class it covers is wider than the defect that prompted it. `<div/>` swallowing its sibling is
 * the most common instance of *"the emitted markup parses to a different tree than the source
 * described"*, and HTML's tree construction has a whole family of others — see `RESHAPED` below,
 * which is a measured record rather than a list somebody remembered.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node',
  'Element', 'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = key === 'window' ? dom.window : dom.window[key];

const { transformJsx } = await load('jsx');
const { renderer } = await load('renderer');
const core = await load('core');
core.wire([renderer]);
const { renderInto } = await load('renderer/hydrate');
const doc = dom.window.document;

/** A tree node. A string is a text node; otherwise `[tag, ...children]`. */
const el = (tag, ...children) => ({ tag, children });

/** The JSX an author would write for this tree — empty elements self-closed, as JSX does. */
const toJsx = (node) =>
  typeof node === 'string'
    ? node
    : node.children.length === 0
      ? `<${node.tag} />`
      : `<${node.tag}>${node.children.map(toJsx).join('')}</${node.tag}>`;

/** The same tree, built rather than parsed — this is the oracle. */
const toDom = (node) => {
  if (typeof node === 'string') return doc.createTextNode(node);
  const element = doc.createElement(node.tag);
  for (const child of node.children) element.appendChild(toDom(child));
  return element;
};

/** Structure only: tag nesting and text, with the renderer's marker comments ignored. */
const shape = (nodes) =>
  [...nodes]
    .filter((node) => node.nodeType !== 8)
    .map((node) => (node.nodeType === 3 ? JSON.stringify(node.data) : `${node.localName}(${shape(node.childNodes)})`))
    .filter((text) => text !== '""')
    .join(',');

const CASES = {
  /* The shapes that must round-trip — and the controls that prove the instrument is not vacuous. */
  'a nested element': [el('div', el('span', 'after'))],
  'siblings': [el('div'), el('span', 'after')],
  'an empty custom element beside a sibling': [el('my-el'), el('span', 'after')],
  'a void element beside a sibling': [el('br'), el('span', 'after')],
  'a list': [el('ul', el('li', 'a'), el('li', 'b'))],
  'deep nesting': [el('div', el('section', el('p', 'x')))],
  'text around an element': [el('p', 'a', el('b', 'c'), 'd')],
  'a table written fully': [el('table', el('tbody', el('tr', el('td', 'c'))))],

  /*
   * The family HTML reshapes. Each is valid-looking JSX, each parses correctly per spec, and each
   * produces a tree the author did not write. None can be normalised the way `<div/>` can: there is
   * no markup that means the nesting, because the nesting is not expressible in HTML at all.
   */
  'a block inside a paragraph': [el('p', el('div', 'x'))],
  'a non-table element inside a table': [el('table', el('span', 'x'))],
  'a list item inside a list item': [el('li', el('li', 'x'))],
  'an element inside a select': [el('select', el('div', 'x'))],
  'an anchor inside an anchor': [el('a', el('a', 'x'))],
  'a button inside a button': [el('button', el('button', 'x'))],
  'a form inside a form': [el('form', el('form', 'x'))],
  'a table row without a tbody': [el('table', el('tr', el('td', 'c')))],
};

/**
 * **The measured record of what HTML reshapes**, taken 2026-09-12 against jsdom and confirmed
 * against Chromium, Firefox and WebKit by `./browser/markup-grammar.test.js`.
 *
 * This is not a list of things to fix — every one of these is the parser obeying its own spec — it
 * is the list of authored shapes that silently become something else, which is exactly the material
 * a diagnostic would need if one is ever built. A case leaving this table means either the fix
 * landed or the case stopped being reachable; either way it should be a deliberate edit, which is
 * why entries carry the observed result rather than just a name.
 */
const RESHAPED = {
  'a block inside a paragraph': ['p(),div("x"),p()', 'the <p> is closed before the <div> and reopened after it'],
  'a non-table element inside a table': ['span("x"),table()', 'foster-parented OUT of the table entirely'],
  'a list item inside a list item': ['li(),li("x")', 'siblings — a <li> closes the open <li>'],
  'an element inside a select': ['select("x")', 'the <div> is DROPPED and only its text survives'],
  'an anchor inside an anchor': ['a(),a("x")', 'siblings — an <a> closes the open <a>'],
  'a button inside a button': ['button(),button("x")', 'siblings'],
  'a form inside a form': ['form("x")', 'the inner <form> is dropped entirely'],
  'a table row without a tbody': ['table(tbody(tr(td("c"))))', 'a <tbody> nobody wrote is inserted'],
};

test('every authored tree parses back to the tree that was authored', () => {
  const unexpected = [];
  const stale = [];
  let compared = 0;

  for (const [name, nodes] of Object.entries(CASES)) {
    /** The oracle: the tree, built rather than parsed. */
    const reference = doc.createElement('div');
    for (const node of nodes) reference.appendChild(toDom(node));

    /** The real path: authored JSX, really compiled, really rendered. */
    const source = nodes.map(toJsx).join('');
    const code = transformJsx(`const view = () => (<>${source}</>);`, 'case.jsx', { inject: false });
    const view = new Function('html', `${code}\nreturn view;`)(core.html);
    const rendered = doc.createElement('div');
    renderInto(view(), rendered);

    compared++;
    const same = shape(reference.childNodes) === shape(rendered.childNodes);
    if (!same && !(name in RESHAPED)) unexpected.push(`${name}\n      authored: ${shape(reference.childNodes)}\n      parsed:   ${shape(rendered.childNodes)}`);
    if (same && name in RESHAPED) stale.push(`${name} — recorded as reshaped, but it now round-trips. Delete its RESHAPED row.`);
  }

  assert.equal(compared, Object.keys(CASES).length, 'NON-ZERO CONTROL: every case must have been built and rendered');
  assert.ok(Object.keys(RESHAPED).length > 0, 'NON-ZERO CONTROL: an empty record means the instrument stopped finding what it found in 2026-09');
  assert.deepEqual(unexpected, [],
    `\n\n  ${unexpected.length} authored tree(s) reach the DOM as a DIFFERENT tree, and nothing says so:\n\n    ${unexpected.join('\n\n    ')}\n`);
  assert.deepEqual(stale, [], `\n\n    ${stale.join('\n    ')}\n`);
});

/**
 * The reshaping cases are here as a RECORD, so the record has to be true. Without this, a wrong
 * entry would sit in `RESHAPED` forever describing a reshaping that no longer happens, and the
 * suite above would keep passing — the case would simply be excused rather than checked.
 */
test('the record of what HTML reshapes says what actually happens', () => {
  for (const [name, [expected, why]] of Object.entries(RESHAPED)) {
    assert.ok(name in CASES, `${name} is recorded as reshaped but is not a case`);
    assert.ok(why.length > 0, `${name}: a record that does not say WHAT happens excuses the case instead of checking it`);

    const source = CASES[name].map(toJsx).join('');
    const code = transformJsx(`const view = () => (<>${source}</>);`, 'case.jsx', { inject: false });
    const view = new Function('html', `${code}\nreturn view;`)(core.html);
    const rendered = doc.createElement('div');
    renderInto(view(), rendered);
    assert.equal(shape(rendered.childNodes), expected,
      `${name}: the recorded reshaping is not what happens any more — re-measure before editing the note`);
  }
});
