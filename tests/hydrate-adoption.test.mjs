/**
 * **How adoption treats what it adopts** — the decisions the rebuilt hydrate entry makes, each pinned.
 *
 * - An attribute the server got RIGHT costs no write; a wrong one is repaired (it is read, not re-set).
 * - An owned SOLE position (`<ul>${rows}</ul>`) adopts with no marker put in at all.
 * - A form control's value — written, or a spread's key — is recorded, not written: what the user typed before the
 *   script arrived stands.
 * - A ref inside markup a mismatch discards is never called; the fallback render's ref is called once.
 * - A `_$child$` applier is told it is adopting (once, on adoption); at a SOLE position it is handed what the server
 *   put there, and replacing it leaves no duplicate.
 * - What client code renders DURING adoption is built fresh, in full — adopting is scoped to adopted bindings.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { html } = await load('core');
const { renderInto: hydrateInto } = await load('renderer/hydrate');
const { spread } = await load('renderer/spread');

/** A container holding server markup, with a MutationObserver counting what adoption writes into it. */
const served = (markup) => {
  const host = document.body.appendChild(document.createElement('div'));
  host.innerHTML = markup;
  const records = [];
  const observer = new dom.window.MutationObserver((list) => records.push(...list));
  observer.observe(host, { subtree: true, childList: true, attributes: true, characterData: true });
  return {
    host,
    writes: () => {
      records.push(...observer.takeRecords());
      return records;
    },
  };
};
const quietly = (work) => {
  const said = [];
  const { warn } = console;
  console.warn = (...args) => said.push(args.join(' '));
  try {
    work();
  } finally {
    console.warn = warn;
  }
  return said;
};

test('an attribute the server got right costs no write; a wrong one is repaired', () => {
  const draw = (cls, title) => html`<p class=${cls} title=${title}>x</p>`;
  const { host, writes } = served('<p class="a" title="wrong">x</p>');
  const p = host.querySelector('p');
  const said = quietly(() => hydrateInto(draw('a', 'right'), host));
  assert.deepEqual(said, [], 'CONTROL: adopted, not fallen back');
  assert.equal(host.querySelector('p'), p, 'the server node was kept');
  const attributes = writes().filter((r) => r.type === 'attributes').map((r) => r.attributeName);
  assert.deepEqual(attributes, ['title'], 'only the wrong attribute was written');
  assert.equal(p.getAttribute('title'), 'right');
});

test('an owned SOLE position adopts with no marker put in', () => {
  const rows = ['a', 'b'].map((x) => html`<li>${x}</li>`);
  const { host, writes } = served('<ul><li>a</li><li>b</li></ul>');
  const ul = host.querySelector('ul');
  const said = quietly(() => hydrateInto(html`<ul>${rows}</ul>`, host));
  assert.deepEqual(said, [], 'CONTROL: adopted');
  const insideUl = writes().filter((r) => r.type === 'childList' && r.target !== host);
  assert.deepEqual(insideUl.map((r) => r.target.localName), [], 'nothing was inserted inside the <ul>');
  assert.equal([...ul.childNodes].filter((n) => n.nodeType === 8).length, 0);
});

test("a spread's .value key on an input records the value — what was typed before the script arrived stands", () => {
  const draw = (v) => html`<input ${spread({ '.value': v })}>`;
  const { host } = served('<input value="server">');
  const input = host.querySelector('input');
  input.value = 'typed';
  const said = quietly(() => hydrateInto(draw('server'), host));
  assert.deepEqual(said, [], 'CONTROL: adopted');
  assert.equal(host.querySelector('input'), input);
  assert.equal(input.value, 'typed', 'adoption did not overwrite the typing');
  hydrateInto(draw('next'), host);
  assert.equal(input.value, 'next', 'a real change still lands');
});

test('a ref inside markup a mismatch discards is never called; the fallback render calls it once', () => {
  const calls = [];
  const ref = (el) => calls.push(el?.textContent ?? null);
  const { host } = served('<p>stale</p><b>extra</b>');
  const serverP = host.querySelector('p');
  quietly(() => hydrateInto(html`<p ${ref}>stale</p>`, host));
  assert.notEqual(host.querySelector('p'), serverP, 'CONTROL: this markup mismatched (trailing <b>) and was rendered fresh');
  assert.deepEqual(calls, ['stale'], 'called once, with the fresh element');
  assert.equal(host.querySelector('b'), null, 'the discarded markup is gone');
});

test('a _$child$ applier is told it is adopting, once, and at a SOLE position replacing the server content leaves no duplicate', () => {
  const seen = [];
  const applier = { _$child$(part, previous, adopting) { seen.push(adopting === true); part._$commit$(html`<i>client</i>`); } };
  const { host } = served('<div><i>server</i></div>');
  const said = quietly(() => hydrateInto(html`<div>${applier}</div>`, host));
  assert.deepEqual(said, [], 'CONTROL: adopted');
  assert.deepEqual(seen, [true], 'told it was adopting');
  assert.equal(host.querySelector('div').innerHTML, '<i>client</i>', 'the server content was replaced, not duplicated');
  hydrateInto(html`<div>${applier}</div>`, host);
  assert.deepEqual(seen, [true, false], 'a later render is not adopting');
});

test('an applier that adopts what the server rendered keeps those very nodes', () => {
  const adopter = { _$child$(part, previous, adopting) { if (!adopting) part._$commit$(html`<i>client</i>`); return 'kept'; } };
  const { host } = served('<div><i>server</i></div>');
  const i = host.querySelector('i');
  quietly(() => hydrateInto(html`<div>${adopter}</div>`, host));
  assert.equal(host.querySelector('i'), i, 'the server node stayed');
});

/**
 * Adopting is scoped to the adopted binding's own commit. A component whose setter renders synchronously runs INSIDE
 * that commit — adoption delivering its `.prop` — and what it renders is a fresh render that must be written in full.
 */
test('what client code renders DURING an adopted commit is built in full — a fresh input gets its value', () => {
  customElements.define('x-renders-on-set', class extends HTMLElement {
    set data(v) { hydrateInto(html`<input .value=${v}>`, this); }
  });
  const { host } = served('<div><x-renders-on-set></x-renders-on-set></div>');
  const said = quietly(() => hydrateInto(html`<div><x-renders-on-set .data=${'fresh'}></x-renders-on-set></div>`, host));
  assert.deepEqual(said, [], 'CONTROL: adopted');
  const input = host.querySelector('x-renders-on-set input');
  assert.ok(input, 'CONTROL: the setter rendered, during adoption');
  assert.equal(input.value, 'fresh', 'its .value was written, not recorded');
});

test("a written .value on an input records the value — what was typed before the script arrived stands", () => {
  const draw = (v) => html`<input .value=${v}>`;
  const { host } = served('<input value="server">');
  const input = host.querySelector('input');
  input.value = 'typed';
  const said = quietly(() => hydrateInto(draw('server'), host));
  assert.deepEqual(said, [], 'CONTROL: adopted');
  assert.equal(input.value, 'typed');
  hydrateInto(draw('next'), host);
  assert.equal(input.value, 'next', 'a real change still lands');
});

/**
 * A light-DOM component the server rendered arrives with its render as its children. The parent's template writes
 * nothing inside the tag, so those children are not the parent's to compare: the parent adopts, and the component's
 * nodes stay exactly as they are for the component to adopt.
 */
test("a component's own children are its render: a parent that writes none inside it adopts, and leaves them be", () => {
  const { host } = served('<section><x-light-card><h2>its own</h2></x-light-card><p>after</p></section>');
  const h2 = host.querySelector('h2');
  const said = quietly(() => hydrateInto(html`<section><x-light-card .data=${1}></x-light-card><p>after</p></section>`, host));
  assert.deepEqual(said, [], 'adopted, not fallen back');
  assert.equal(host.querySelector('h2'), h2, "the component's node was kept");
});
