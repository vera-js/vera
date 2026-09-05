/**
 * `</style` inside CSS must not survive into a style element's SERIALIZATION.
 *
 * The live page is never the victim: a style element's textContent is not re-parsed, so the sheet
 * works either way. The hole is everything that reads the markup back — `innerHTML` copies, a
 * server round trip — where a raw `</style>` closes the element early and what follows becomes
 * live markup. `@verajs/ssr` had exactly that hole once, and its `escapeStyleText` is
 * **deliberately twinned** in `@verajs/styles` (each side's comment names the other; the escape
 * `<\/style` is valid CSS and renders identically). The server twin is pinned by
 * `ssr-injection-fuzz`; this is the CLIENT twin's pin, on both element paths — the light-DOM
 * hoist to `document.head` and the shadow-root fallback — so an edit to either copy fails
 * somewhere, which is the whole point of pinning deliberate duplication (pass-5 rule).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element'])
  globalThis[key] = dom.window[key];

const { applyStyles } = await load('styles');
const HOSTILE = '.a{content:"</style><script>alert(1)</script>"}';

test('a hoisted light-DOM sheet serializes without a breakout', () => {
  class Light extends HTMLElement {}
  customElements.define('x-esc-light', Light);
  const element = new Light();
  document.body.append(element);
  const before = document.head.querySelectorAll('style').length;

  applyStyles([HOSTILE], element);

  const styles = [...document.head.querySelectorAll('style')];
  assert.equal(styles.length - before, 1, 'CONTROL: the hostile sheet was actually hoisted');
  const mine = styles[styles.length - 1];
  assert.ok(mine.textContent.includes('<\\/style'), 'the escape landed in the text');
  assert.ok(!mine.outerHTML.includes('</style><script>'), 'and the serialization cannot break out');
});

test('a shadow-root style element serializes without a breakout', () => {
  class Shadow extends HTMLElement {}
  customElements.define('x-esc-shadow', Shadow);
  const element = new Shadow();
  document.body.append(element);
  const root = element.attachShadow({ mode: 'open' });

  applyStyles([HOSTILE], element);

  const mine = root.querySelector('style');
  assert.ok(mine, 'CONTROL: the shadow path wrote a style element at all');
  assert.ok(mine.textContent.includes('<\\/style'), 'the escape landed in the text');
  assert.ok(!root.innerHTML.includes('</style><script>'), 'and the serialization cannot break out');
});
