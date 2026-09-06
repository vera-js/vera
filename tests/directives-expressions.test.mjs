/**
 * The expression tier: the corpus (omniwp compatibility evidence + vera's adversarial set), the
 * connector integration (`wireDirectives([expressions])` upgrades every value position — whole
 * expressions, object VALUES, state initials in declaration order), thunk caching, and the
 * standalone-additive rule: this file loads the tier's OWN bundle beside the engine's, which on
 * production is exactly the CDN two-bundle page.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent',
  'MutationObserver', 'CSSStyleSheet']) globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { wireDirectives, interaction, settled, stateOf } = await load('directives');
const { expressions, compileExpression } = await load('directives/expressions');
const doc = dom.window.document;

wireDirectives(interaction);
wireDirectives([expressions]);

const corpus = JSON.parse(readFileSync(new URL('./fixtures/directives-expression-corpus.json', import.meta.url), 'utf8'));
const readFrom = (context) => (segments, global) => {
  void global;
  let v = context;
  for (const seg of segments) {
    if (v !== null && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, seg)) v = v[seg];
    else return undefined;
  }
  return v;
};

test('the compatibility corpus: omniwp ground answers identically', () => {
  for (const c of corpus.compat) {
    if (c.veraThrows) {
      assert.throws(() => compileExpression(c.expression), (e) => e.code === c.veraThrows, `${c.name}: designed refusal`);
      continue;
    }
    const got = compileExpression(c.expression)(readFrom(c.context ?? {}));
    /** omniwp's corpus is boolean-position truth — compare coerced, its own documented contract.
     *  A `veraStrict` override marks a DESIGNED divergence: our equality is strict (§19.2). */
    const want = c.veraStrict ? c.veraStrict.expected : c.expected;
    assert.equal(!!got, !!want, `${c.name}: ${c.expression}`);
  }
});

test('the adversarial corpus: refusals refuse, calm math stays calm, strictness is strict', () => {
  for (const c of corpus.adversarial) {
    if (c.throws) {
      let code = null;
      try {
        compileExpression(c.expression)(readFrom(c.context ?? {}));
      } catch (error) {
        code = error.code;
      }
      assert.equal(code, c.throws, `${c.name}: expected ${c.throws}, got ${code}`);
      continue;
    }
    const got = compileExpression(c.expression)(readFrom(c.context ?? {}));
    if (c.expectedNaN) assert.ok(Number.isNaN(got), c.name);
    else if (c.expectedInfinity) assert.equal(got, Infinity, c.name);
    else if (c.expectedObject) assert.deepEqual({ ...got }, c.expectedObject, c.name);
    else assert.deepEqual(got, c.expected, c.name);
  }
});

test('parsed object literals carry no prototype', () => {
  const got = compileExpression("{ a: 1 }")(readFrom({}));
  assert.equal(Object.getPrototypeOf(got), null, 'null-proto by construction');
});

test('the tier upgrades the page: comparisons in show, arithmetic in class, exprs in handlers', async () => {
  const host = doc.createElement('div');
  host.innerHTML = `
    <div data-vd-state="{ tab: 'intro', qty: 2, price: 20 }">
      <section data-vd-show="tab == 'pricing'">prices</section>
      <p data-vd-class="{ bulk: qty * price > 100 }"></p>
      <button data-vd-on-click="{ tab: tab == 'intro' ? 'pricing' : 'intro', qty: qty + 3 }">go</button>
    </div>`;
  doc.body.appendChild(host);
  await settled();
  const section = host.querySelector('section');
  const p = host.querySelector('p');
  assert.equal(section.hidden, true, 'tab is intro, pricing hidden');
  assert.equal(p.classList.contains('bulk'), false, '40 is not bulk');

  host.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await settled();
  assert.equal(section.hidden, false, 'the ternary flipped the tab');
  assert.equal(p.classList.contains('bulk'), false, 'qty 5 × 20 = 100, and 100 > 100 is false — strict');
  host.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await settled();
  assert.equal(p.classList.contains('bulk'), true, 'qty 8 × 20 = 160 crosses the line');
  host.remove();
});

test('state initials are expressions, in declaration order, against earlier keys', async () => {
  const host = doc.createElement('div');
  host.innerHTML = `<div data-vd-state="{ price: 20, qty: 3, total: price * qty }"><i data-vd-show="total == 60"></i></div>`;
  doc.body.appendChild(host);
  await settled();
  assert.equal(stateOf(host.firstElementChild).total, 60, 'total derived from earlier keys');
  assert.equal(host.querySelector('i').hidden, false);
  host.remove();
});
