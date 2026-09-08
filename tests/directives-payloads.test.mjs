/**
 * **`$` variables — what a handler can read about the event that ran it (design §20.1).**
 *
 * Before this a handler could write constants and re-read state, so the commonest interaction there
 * is — type into a box, filter a list — required `data-vd-sync` and a state key whether the page
 * wanted one or not. `{ q: $value }` is the whole point.
 *
 * The claims worth pinning are the ones a naive version gets wrong. It cannot be "read the event":
 * native event properties live on PROTOTYPES, so the own-property walk every path resolution here
 * does would read nothing at all — and reaching through the prototype chain would hand attribute
 * text the entire DOM API. So each base declares an extractor returning primitives, which is what
 * makes the vocabulary enumerable and an unknown name a REFUSAL rather than an empty string.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent',
  'MutationObserver', 'CSSStyleSheet']) globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { wireDirectives, expressions, interaction, settled, rejections, stateOf,
  describePayloads, wirePayloads } = await load('directives');
wireDirectives([expressions, ...interaction]);

const doc = dom.window.document;
const mount = async (html) => {
  const host = doc.createElement('div');
  host.innerHTML = html;
  doc.body.appendChild(host);
  await settled();
  return host;
};

test('an input handler reads the box it fired from', async () => {
  const host = await mount(`
    <div data-vd-state="{ q: '', on: false }">
      <input id="text" data-vd-on-input="{ q: $value }" />
      <input id="box" type="checkbox" data-vd-on-change="{ on: $checked }" />
    </div>`);
  const carrier = host.querySelector('[data-vd-state]');

  const text = host.querySelector('#text');
  text.value = 'ber';
  text.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await settled();
  assert.equal(stateOf(carrier).q, 'ber', 'the filter needs no data-vd-sync and no extra state key');

  const box = host.querySelector('#box');
  box.checked = true;
  box.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await settled();
  assert.equal(stateOf(carrier).on, true, '$checked is a boolean, not the string "true"');
  host.remove();
  await settled();
});

test('pointer and keyboard bases carry their own vocabulary, and expressions can use it', async () => {
  const host = await mount(`
    <div data-vd-state="{ x: 0, half: 0, key: '' }">
      <button id="b" data-vd-on-click="{ x: $x, half: $x / 2 }">go</button>
      <input id="k" data-vd-on-keydown="{ key: $key }" />
    </div>`);
  const carrier = host.querySelector('[data-vd-state]');

  host.querySelector('#b').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, clientX: 42 }));
  await settled();
  assert.equal(stateOf(carrier).x, 42, '$x is the page coordinate');
  assert.equal(stateOf(carrier).half, 21, 'and it is a NUMBER — arithmetic works, so it went through the tier');

  host.querySelector('#k').dispatchEvent(new dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
  await settled();
  assert.equal(stateOf(carrier).key, 'Enter');
  host.remove();
  await settled();
});

test('every base answers $type, including one nothing has described', async () => {
  const host = await mount(`
    <div data-vd-state="{ what: '' }">
      <div id="d" data-vd-on-focusin="{ what: $type }"></div>
    </div>`);
  host.querySelector('#d').dispatchEvent(new dom.window.Event('focusin', { bubbles: true }));
  await settled();
  assert.equal(stateOf(host.querySelector('[data-vd-state]')).what, 'focusin',
    'the honest floor: a handler on an undescribed base can still say what ran it');
  host.remove();
  await settled();
});

test('AN UNKNOWN $var IS REFUSED — once, and with what this event does offer', async () => {
  const host = await mount(`
    <div data-vd-state="{ q: '' }">
      <input id="bad" data-vd-on-input="{ q: $vlaue }" />
    </div>`);
  const bad = host.querySelector('#bad');
  bad.value = 'x';
  bad.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await settled();

  const complaints = rejections(bad).filter((r) => r.code === 'unknown-payload-var');
  assert.equal(complaints.length, 1,
    'ONE refusal: a $ name never also falls through to state, or a typo produced a second and ' +
    'nonsensical "no ancestor state declares $vlaue"');
  assert.deepEqual(rejections(bad).filter((r) => r.code === 'unknown-key'), [], 'and nothing from the context layer');
  if (!isProduction) {
    assert.match(complaints[0].message, /\$vlaue/, 'names what was written');
    assert.match(complaints[0].fix, /\$value/, 'and suggests what was meant');
  }

  /** THE POINT: silence would have written an empty string and read on screen as a filter that
   *  matches everything — a working page with wrong behaviour. */
  assert.equal(stateOf(host.querySelector('[data-vd-state]')).q, '', 'nothing was written from a name that does not exist');
  host.remove();
  await settled();
});

test('a page may register its own base, and the vocabulary is introspectable', async () => {
  wirePayloads({ 'vera:ping': { vars: ['strength'], read: (event) => ({ strength: event.detail?.strength ?? 0 }) } });

  const host = await mount(`
    <div data-vd-state="{ got: 0 }">
      <div id="p" data-vd-on-vera:ping="{ got: $strength }"></div>
    </div>`);
  host.querySelector('#p').dispatchEvent(
    new dom.window.CustomEvent('vera:ping', { bubbles: true, detail: { strength: 7 } }));
  await settled();
  assert.equal(stateOf(host.querySelector('[data-vd-state]')).got, 7, 'the same door packs use');

  const described = describePayloads();
  const ping = described.find((one) => one.base === 'vera:ping');
  assert.deepEqual(ping, { base: 'vera:ping', vars: ['$strength'] },
    'a picker that lists a base without its variables has told an author the word and withheld the sentence');
  assert.ok(described.some((one) => one.base === 'input' && one.vars.includes('$value')),
    'and the engine defaults are described the same way');
  host.remove();
  await settled();
});
