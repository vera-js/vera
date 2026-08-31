/**
 * Light-DOM style hoisting when one component class extends another.
 *
 * The rule is "hoisted to the document once per component class, ever", and it was implemented as a
 * flag on the class: `if (owner[HOISTED]) return; owner[HOISTED] = true`.
 *
 * `class Child extends Base` makes `Base` the **prototype of `Child`**, so that read finds the flag
 * the base set and returns. The subclass's `static styles` are then never hoisted at all — the
 * component renders unstyled, and nothing is logged.
 *
 * ## Why it survived
 *
 * It is **order-dependent**. Inheritance only looks upward, so mounting the child first hoists both:
 * the child sets its own flag, and the base still has none of its own. Only base-before-child fails.
 * A page could therefore style correctly in development and not in production, decided by which
 * instance happened to render first.
 *
 * `styles-hoisting-fuzz` states the same invariant and cannot reach this: it generates
 * `class extends HTMLElement` and varies the *instances*, so every class in it is flat. The
 * invariant it checks is "one hoist per class"; the failure here is **zero** hoists for a class its
 * generator cannot produce.
 *
 * ## The subclass that declares nothing
 *
 * It inherits the base's CSS, but its tag is different, so the base's `@scope (base-tag)` block never
 * matches it. Hoisting its own copy is what makes those rules apply — which is why the count below is
 * three rather than two.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'https://x.test/', pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame',
  'MutationObserver', 'ShadowRoot',
])
  globalThis[key] = dom.window[key];

const core = await load('core');
const { renderer } = await load('renderer');
const { html } = await load('renderer/tag');
const { styles } = await load('styles');
core.wire([renderer, styles]);

const frame = () => new Promise((resolve) => setTimeout(resolve, 20));
const app = dom.window.document.getElementById('app');
const head = () => dom.window.document.head.innerHTML;
const mount = async (tag, count = 1) => {
  for (let i = 0; i < count; i++) app.appendChild(dom.window.document.createElement(tag));
  await frame();
};

/** Unique marker per class, so a miscount names which one is missing. */
const component = (css) =>
  class extends dom.window.HTMLElement {
    static styles = css;
    connectedCallback() {
      core.init(this);
      core.render(() => html`<p>x</p>`);
    }
  };

test('a subclass hoists its own styles when the base mounted first', async () => {
  const Base = component('p{--base-first:1}');
  class Child extends Base { static styles = 'p{--child-first:1}'; }
  customElements.define('inherit-base', Base);
  customElements.define('inherit-child', Child);

  await mount('inherit-base');
  assert.match(head(), /--base-first/, 'the base hoisted — the control');

  await mount('inherit-child');
  assert.match(head(), /--child-first/, 'the subclass hoisted rather than reading the base flag');
});

/** The order that always worked, kept so a fix cannot trade one direction for the other. */
test('and when the subclass mounted first', async () => {
  const Base = component('p{--base-second:1}');
  class Child extends Base { static styles = 'p{--child-second:1}'; }
  customElements.define('order-child', Child);
  customElements.define('order-base', Base);

  await mount('order-child');
  assert.match(head(), /--child-second/, 'the subclass hoisted');

  await mount('order-base');
  assert.match(head(), /--base-second/, 'and the base still hoisted after it');
});

test('a subclass that declares no styles of its own still gets a copy for its tag', async () => {
  const Base = component('p{--bare-base:1}');
  class Bare extends Base {}
  customElements.define('bare-base', Base);
  customElements.define('bare-sub', Bare);

  await mount('bare-base');
  const before = (head().match(/--bare-base/g) ?? []).length;
  assert.equal(before, 1, 'the base hoisted once');

  await mount('bare-sub');
  assert.equal(
    (head().match(/--bare-base/g) ?? []).length, 2,
    'the subclass hoisted its own, because the base scope names the base tag and not this one'
  );
});

/** The original invariant, which the fix must not trade away. */
test('and it is still once per class however many instances', async () => {
  const Base = component('p{--many:1}');
  class Child extends Base { static styles = 'p{--many-child:1}'; }
  customElements.define('many-base', Base);
  customElements.define('many-child', Child);

  await mount('many-base', 5);
  await mount('many-child', 5);
  await mount('many-base', 5);

  assert.equal((head().match(/--many:/g) ?? []).length, 1, 'the base hoisted exactly once');
  assert.equal((head().match(/--many-child/g) ?? []).length, 1, 'and the subclass exactly once');
});
