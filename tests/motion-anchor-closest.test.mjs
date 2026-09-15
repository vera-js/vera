/**
 * **`anchor` NAMES AN ELEMENT, AND THERE ARE TWO HONEST WAYS TO NAME ONE.**
 *
 * `anchor: '#section'` resolves with `querySelector`; `anchor: 'closest(.card)'` resolves with
 * `Element.closest`, walking UP from this element. The second exists because the first cannot
 * express "my own section" in repeated markup: give every card the same `#id` or class and every
 * copy on the page resolves to whichever the document happens to put first.
 *
 * **The selector-list rule differs between them ON PURPOSE**, and the test is not whether a comma
 * appears but *what the resolution does with one*:
 *   - `querySelector('.a, .b')` returns whichever matches FIRST IN DOCUMENT ORDER. The author wrote
 *     "either" and got "whichever the page happened to put first" — a silent arbitrary pick, which
 *     is recovery rather than API, so the plain form REFUSES a list.
 *   - `Element.closest('.a, .b')` returns the nearest ancestor matching EITHER. That is
 *     unambiguous, so `closest()` ALLOWS one — the same rule `when` already relies on with
 *     `matches()`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver',
  'CSSStyleSheet', 'getComputedStyle']) globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { parseMotion } = await load('motion/internal');

/** The surviving `anchor`, or the refusal codes if it did not survive. */
const anchorOf = (value) => {
  const dropped = [];
  const parsed = parseMotion(dom.window.document.createElement('div'),
    `{ keyframes: { opacity: '0, 1' }, anchor: '${value}' }`, { dropped });
  const rejected = [...(parsed?.rejected ?? []), ...dropped.flatMap((d) => d.rejected ?? [])];
  return rejected.length ? rejected.map((r) => r.code) : (parsed?.settings?.anchor ?? null);
};

test('a plain selector still works, and `self` still means the element itself', () => {
  /** The CONTROL. Without it every refusal below could be `anchor` having stopped working outright. */
  assert.equal(anchorOf('#section'), '#section');
  assert.equal(anchorOf('.hero'), '.hero');
  assert.equal(anchorOf('self'), 'self');
});

test('closest() is accepted and survives as written', () => {
  assert.equal(anchorOf('closest(.card)'), 'closest(.card)');
  assert.equal(anchorOf('closest(section)'), 'closest(section)');
});

test('a selector LIST is refused for the plain form — querySelector would pick one arbitrarily', () => {
  assert.deepEqual(anchorOf('.a, .b'), ['motion-setting-selector'],
    'the author wrote "either" and querySelector would answer "whichever is first in the document"');
});

test('…but ALLOWED inside closest(), where it honestly means "either ancestor"', () => {
  assert.equal(anchorOf('closest(.a, .b)'), 'closest(.a, .b)');
});

test('a malformed selector is still refused inside the wrapper', () => {
  /** The wrapper must not become a hole in the validation it wraps. */
  assert.deepEqual(anchorOf('closest(:has(.x))'), ['motion-setting-selector'], ':has is refused either way');
  assert.deepEqual(anchorOf('closest()'), ['motion-setting-selector'], 'an empty selector is not a selector');
  assert.deepEqual(anchorOf('closest(.a'), ['motion-setting-selector'], 'an unclosed wrapper is not a wrapper');
});

test('closest() resolves UP the tree — every copy finds its OWN ancestor', async () => {
  /**
   * The behaviour the feature exists for, and the one a settings assertion cannot show. Two
   * identical cards: with `querySelector` BOTH would resolve to the first card's section, which is
   * exactly the bug `closest()` removes.
   */
  const page = new JSDOM(`<!doctype html><body>
    <section class="card" id="one"><div id="a"></div></section>
    <section class="card" id="two"><div id="b"></div></section>
  </body>`);
  const doc = page.window.document;
  for (const id of ['a', 'b']) {
    const el = doc.getElementById(id);
    assert.equal(el.closest('.card').id, id === 'a' ? 'one' : 'two',
      `#${id} resolves to its OWN section`);
  }
  /** The CONTROL that makes the point: querySelector answers the same element for both. */
  assert.equal(doc.querySelector('.card').id, 'one', 'querySelector picks the first for everyone');
});

test('closest() is INCLUSIVE — an element that itself matches is its own anchor', () => {
  /**
   * Documented rather than guarded against: `Element.closest` tests the element before walking up,
   * so a card carrying both the motion attribute and `.card` measures against ITSELF. That is the
   * useful reading — the alternative would need a second spelling to say "me, or my ancestor" — but
   * it is surprising if you read the name as "ancestor", which is why the docs say "the element
   * itself or its nearest matching ancestor".
   */
  const page = new JSDOM('<!doctype html><body><section class="card" id="outer"><div id="inner" class="card"></div></section></body>');
  const doc = page.window.document;
  assert.equal(doc.getElementById('inner').closest('.card').id, 'inner', 'itself, not the outer card');
  /** The CONTROL: a non-matching element DOES walk up, so the above is inclusivity and not a stub. */
  const plain = doc.createElement('div');
  doc.getElementById('inner').appendChild(plain);
  assert.equal(plain.closest('.card').id, 'inner', 'a non-matching element walks up as expected');
});

test('closest() stops at a shadow boundary — a component cannot anchor into the page', () => {
  /**
   * The scoping property that makes `closest()` safe inside a component, and the reason the two
   * anchor consumers had to be unified: `resolveRange` resolved through the element's OWN root while
   * `pointerSourceValue` resolved through `ownerDocument`, so the SAME attribute scoped one way for
   * scroll and reached into the whole page for pointer. Both go through `anchorElement` now, which
   * takes the node's root — so a pointer anchor inside a shadow tree that used to find a page-level
   * element no longer does. **That is a change to shipped behaviour**, in the direction
   * CODE-PRINCIPLES §2 requires (the scope comes from the node), and it is pinned here.
   */
  const page = new JSDOM('<!doctype html><body><section class="card" id="page-level"><div id="host"></div></section></body>');
  const doc = page.window.document;
  const root = doc.getElementById('host').attachShadow({ mode: 'open' });
  const inside = doc.createElement('div');
  root.appendChild(inside);

  assert.equal(inside.closest('.card'), null,
    'the page-level .card is NOT reachable from inside the shadow root');
  /** The CONTROL: the same selector resolves when the match is inside the root, so `null` above is
   *  the boundary and not `closest` failing in a detached-ish tree. */
  const inner = doc.createElement('section');
  inner.className = 'card';
  root.appendChild(inner);
  inner.appendChild(inside);
  assert.equal(inside.closest('.card'), inner, 'an in-root match resolves normally');
});
