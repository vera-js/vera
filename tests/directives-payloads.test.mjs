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

const { wireDirectives, expressions, interactions, settled, rejections, stateOf,
  describePayloads, wirePayloads } = await load('directives');
wireDirectives([expressions, ...interactions]);

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
  /** NAME → getter, so a base cannot declare a variable it never reads or read one it never
   *  declared — the two-field shape this replaced allowed both. */
  wirePayloads({ 'vera:ping': { strength: (event) => event.detail?.strength ?? 0 } });

  const host = await mount(`
    <div data-vd-state="{ got: 0 }">
      <div id="p" data-vd-on-vera:ping="{ got: $strength }"></div>
    </div>`);
  host.querySelector('#p').dispatchEvent(
    new dom.window.CustomEvent('vera:ping', { bubbles: true, detail: { strength: 7 } }));
  await settled();
  assert.equal(stateOf(host.querySelector('[data-vd-state]')).got, 7, 'the same door packs use');

  const described = describePayloads();
  /**
   * **The universal row, which this API lacked.** It listed only bases someone had registered, so
   * `focusin` was absent although it answers `$type` — and a consumer reading the list concluded
   * that base offered nothing. An introspection API is worth what its completeness is worth.
   */
  assert.deepEqual(described[0], { base: '*', vars: ['$type'] },
    'the floor every event shares is in the DATA, not in a sentence a reader has to have found');

  const ping = described.find((one) => one.base === 'vera:ping');
  assert.deepEqual(ping, { base: 'vera:ping', vars: ['$strength', '$type'] },
    'a picker that lists a base without its variables has told an author the word and withheld ' +
    'the sentence — and $type is in scope everywhere, so it is listed everywhere');
  assert.ok(described.some((one) => one.base === 'input' && one.vars.includes('$value')),
    'and the engine defaults are described the same way');
  host.remove();
  await settled();
});

/**
 * The three ways a `$` can be wrong that are NOT "that name does not exist" — each its own code,
 * because a refusal that cannot say which mistake was made is barely better than silence.
 */
test('a dotted $ path is REFUSED, not silently truncated', async () => {
  const host = await mount(`
    <div data-vd-state="{ n: 0 }">
      <input id="i" data-vd-on-input="{ n: $value.length }" />
    </div>`);
  const input = host.querySelector('#i');
  input.value = 'abcd';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await settled();

  assert.ok(rejections(input).some((r) => r.code === 'payload-not-walkable'));
  /** It ANSWERED "abcd" before — the tail was dropped and the whole primitive returned, which is a
   *  wrong value wearing the shape of a right one. Supporting it is not the fix either: property
   *  access on a primitive reopens the prototype surface extractors exist to close. */
  assert.equal(stateOf(host.querySelector('[data-vd-state]')).n, 0, 'and nothing was written');
  host.remove();
  await settled();
});

test('a $ outside a handler says so, rather than blaming the directive', async () => {
  const host = await mount(`<div data-vd-state="{ n: 0 }"><b id="b" data-vd-text="$value"></b></div>`);
  const codes = rejections(host.querySelector('#b')).map((r) => r.code);
  assert.ok(codes.includes('payload-outside-handler'),
    'it reported `directive-threw: value` before — a code accusing a directive of misbehaving ' +
    'about a page that made an ordinary authoring mistake, with a bare word for a message');
  assert.ok(!codes.includes('directive-threw'), 'a refusal that names itself keeps its name however far it is thrown');
  host.remove();
  await settled();
});

test('a getter that breaks the primitives contract is caught, not propagated', async (t) => {
  if (isProduction) return t.skip('the contract is enforced where the author of the getter is standing');

  wirePayloads({ 'vera:bad': { thing: () => ({ walkable: true }) } });
  const host = await mount(`
    <div data-vd-state="{ got: 0 }"><div id="x" data-vd-on-vera:bad="{ got: $thing }"></div></div>`);
  host.querySelector('#x').dispatchEvent(new dom.window.CustomEvent('vera:bad', { bubbles: true }));
  await settled();

  assert.ok(rejections().some((r) => r.code === 'payload-not-primitive'),
    'nothing enforced this: a getter returning an object hands attribute text a walkable graph, ' +
    'which is exactly what extractors exist to prevent — and it is third-party code');
  host.remove();
  await settled();
});

test('the documented vocabulary IS the runtime vocabulary', async () => {
  const { readFileSync } = await import('node:fs');
  const published = JSON.parse(
    readFileSync(new URL('../packages/directives/diagnostics.json', import.meta.url), 'utf8'));

  /**
   * `$x $y $button` was typed by hand into `llms.txt`, the package README and the source, with
   * nothing checking any copy against another — so adding `$deltaY` for `wheel` meant editing three
   * places and failing nowhere. `sync-diagnostics.mjs` owns the block between the doc markers now;
   * this asserts the ARTIFACT it publishes matches what the engine actually resolves, which is the
   * half a text-substitution check cannot see.
   */
  const runtime = new Map(describePayloads().map((row) => [row.base, row.vars.join(' ')]));
  for (const { bases, vars } of published.payloads) {
    for (const base of bases) {
      assert.equal(runtime.get(base), vars.join(' '),
        `${base} is published as "${vars.join(' ')}" and resolves as "${runtime.get(base)}"`);
    }
  }
  assert.ok(published.payloads.length >= 4, 'the control: the artifact describes something at all');
});
