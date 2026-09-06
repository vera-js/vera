/**
 * **Every binding path, every dangerous name — the two spellings must agree.**
 *
 * `@verajs/renderer` refuses a handful of names that cannot be written safely. The rule lives in
 * TWO places on purpose: `AttrPart`'s constructor for the template spellings (`.name`, `!name`) and
 * `refusedSink` in `./spread.ts` for the runtime bag. The two entries are independent bundles and
 * neither imports the other, so the duplication is deliberate — and a deliberate duplication is a
 * fix's second address. `__proto__` was refused in spread (arc-1) and NOT in the template path,
 * where `.__proto__` crashed out of the commit with an unreadable internal error and `!__proto__`
 * bricked the element silently, the wreckage surfacing in a later render (arc-2 run 5).
 *
 * This is the matrix that fails when one spelling starts refusing something the other allows.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'requestAnimationFrame',
  'cancelAnimationFrame', 'MutationObserver', 'CSSStyleSheet']) globalThis[k] = dom.window[k];

const { html, wire } = await load('core');
const { renderer, renderInto } = await load('renderer');
const { spread } = await load('renderer/spread');
wire([renderer]);
const doc = dom.window.document;

/** An element is INTACT when it still has the prototype the document gave it. */
const intact = (el) => el instanceof dom.window.HTMLElement && typeof el.removeAttribute === 'function';

test('__proto__ is refused by BOTH the template spellings and the spread bag', () => {
  const original = console.warn;
  console.warn = () => {};
  try {
    for (const [label, draw] of [
      ['template .__proto__', (h) => renderInto(html`<p .__proto__=${{ hacked: 1 }}>x</p>`, h)],
      ['template !__proto__', (h) => renderInto(html`<p !__proto__=${{ hacked: 1 }}>x</p>`, h)],
      ['spread .__proto__', (h) => renderInto(html`<p ${spread({ '.__proto__': { hacked: 1 } })}>x</p>`, h)],
      ['spread !__proto__', (h) => renderInto(html`<p ${spread({ '!__proto__': { hacked: 1 } })}>x</p>`, h)],
    ]) {
      const host = doc.createElement('div');
      doc.body.append(host);
      draw(host);
      const el = host.querySelector('p');
      assert.ok(intact(el), `${label}: the element kept its prototype`);
      assert.equal({}.hacked, undefined, `${label}: Object.prototype untouched`);
      /** The delayed half: a LATER render on the same host must still work. */
      assert.doesNotThrow(() => draw(host), `${label}: a later render survives`);
      host.remove();
    }
  } finally {
    console.warn = original;
  }
});

test('development names the refusal on the template path', { skip: isProduction && 'the message is __DEV__' }, () => {
  const said = [];
  const original = console.warn;
  console.warn = (...args) => said.push(args.join(' '));
  try {
    const host = doc.createElement('div');
    doc.body.append(host);
    renderInto(html`<p .__proto__=${{}}>x</p>`, host);
    host.remove();
  } finally {
    console.warn = original;
  }
  assert.ok(said.some((line) => line.includes('__proto__') && line.includes('[vera]')),
    'the refusal names itself, with the framework prefix');
});

test('a refused binding does not eat its neighbours values', () => {
  const original = console.warn;
  console.warn = () => {};
  try {
    const host = doc.createElement('div');
    doc.body.append(host);
    renderInto(html`<p .__proto__=${{}} title=${'kept'} id=${'also-kept'}>x</p>`, host);
    const el = host.querySelector('p');
    assert.equal(el.getAttribute('title'), 'kept', 'the binding after the refused one still committed');
    assert.equal(el.getAttribute('id'), 'also-kept', 'and the one after that');
    host.remove();
  } finally {
    console.warn = original;
  }
});
