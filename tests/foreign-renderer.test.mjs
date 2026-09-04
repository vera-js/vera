/**
 * **A renderer that is not ours, wired through the `'render'` insert.**
 *
 * Core's claim is that the renderer is an insert like any other: the template tag and the thing
 * that writes to the DOM are both replaceable. Everything else in this repository tests that with
 * vera's own renderer or with a test double shaped like it — and a double written by the same
 * people who wrote the seam proves the seam accepts what they expected, not that it accepts a
 * foreign implementation.
 *
 * lit-html is the honest counterparty: a real renderer, written by other people, with its own
 * template objects, its own part model and its own marker scheme. If core is genuinely not welded
 * to `@verajs/renderer`, `setHtml(litHtml)` plus `wire({ on: 'render', fn: litRender })` is all it
 * should take, and a component should then render, update in place, and keep its host's identity
 * across renders.
 *
 * This replaces a documented recipe that said the same thing in prose. The recipe was hand-run in
 * `examples/npm-ts` and never asserted anywhere, which is the wrong way round for a claim about a
 * public seam: an example is for reading, and this is for failing.
 *
 * **Not a compatibility promise.** Nothing here says vera supports lit as a renderer, and the docs
 * no longer offer it as a mode — `@verajs/renderer` is smaller and faster and is the only renderer
 * the project ships. What is being pinned is the SEAM: that `'render'` takes an arbitrary
 * `(result, container) => void` and core does not inspect what flows through it. lit is standing in
 * for "somebody else's renderer" and would be replaced by any other one just as well.
 *
 * `lit-html` is a root devDependency (`tests/lit-parity.test.mjs` measures against it), so this
 * costs no new dependency. It skips rather than fails if lit is ever dropped, because the seam
 * belongs to core and lit is only the instrument.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent',
  'MutationObserver', 'Comment', 'Text',
]) {
  globalThis[key] = dom.window[key];
}

/** Absent lit is a skipped suite, not a failure: the claim is core's, lit is only the instrument. */
let lit = null;
try {
  lit = await import('lit-html');
} catch {
  lit = null;
}

const { init, createStore, render, setHtml, wire } = await load('core');
const doc = dom.window.document;
const frame = () => new Promise((resolve) => dom.window.requestAnimationFrame(resolve));

test('core drives a FOREIGN renderer through the render insert', { skip: lit === null }, async () => {
  setHtml(lit.html);
  wire({ name: 'test/lit', on: 'render', fn: lit.render, priority: 50 });

  let bump = null;
  customElements.define(
    'foreign-counter',
    class extends dom.window.HTMLElement {
      connectedCallback() {
        init(this);
        const store = createStore({ count: 1 });
        bump = () => (store.count += 1);
        render(() => lit.html`<p class="out">count ${store.count}</p>`);
      }
    }
  );

  const element = doc.createElement('foreign-counter');
  doc.body.append(element);
  await frame();

  const paragraph = element.querySelector('.out');
  assert.ok(paragraph !== null, 'the foreign renderer wrote into the host');
  assert.match(paragraph.textContent, /count 1/, 'and rendered the value');

  /**
   * The update is the half that matters. Anything can write once; keeping the same `<p>` across a
   * re-render is what proves core handed the SAME container back to lit and let lit's own part
   * model do the work, rather than clearing and re-rendering underneath it.
   */
  bump();
  await frame();
  assert.equal(element.querySelector('.out'), paragraph, 'the element survives the update in place');
  assert.match(paragraph.textContent, /count 2/, 'and shows the new value');

  element.remove();
});
