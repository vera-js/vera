/**
 * **The template subscribes; the commit does not.** A render re-runs when what its template function
 * READ changes — never because the commit ran another component's code that read something. Setting
 * a property on a child element runs the child's accessors, and the renderer reads a property before
 * setting it: tracked, a child whose setter writes what its getter reads subscribed its PARENT to that
 * state and re-scheduled it on every pass. Found in an app as a template re-running every frame,
 * forever, on an idle page (`<vera-select .options=${…}>`).
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
const { wire, html, init, createStore } = await load('core');
const { renderer } = await load('renderer');
wire([renderer]);
const frame = () => new Promise((resolve) => dom.window.requestAnimationFrame(resolve));

/**
 * A child whose getter hands back a copy (so `!==` never matches) and whose setter READS its own
 * state and then writes it — the shape of a widget that reconciles a new value against what it holds
 * (`<vera-select>`'s `setOptions` reads its matches, then writes). The read is what subscribed the
 * parent: a setter that only writes did not loop (measured).
 */
customElements.define('x-copying', class extends HTMLElement {
  #state = createStore({ items: [] });
  get items() { return [...this.#state.items]; }
  set items(next) {
    if (this.#state.items.length >= 0) this.#state.items = [...next];
  }
});

/**
 * SKIPPED, deliberately (2026-09-27): untracking the whole commit — the first fix — broke every store
 * value the renderer WALKS during commit (`${state.names}` after a push, `{...state.attrs}`, store Sets),
 * because those reads are the subscription, and it was reverted. The right fix untracks only the
 * SETTER call on an element property, and only when the value changed; until that is built this test
 * would loop and hang the suite. `<vera-select>` itself no longer loops: its setters skip no-op sets.
 */
test('a parent setting a property on such a child renders once, not every frame', { skip: 'awaiting the setter-untrack design — see the comment above' }, async () => {
  const parent = createStore({ items: ['a', 'b'] });
  let renders = 0;
  customElements.define('x-parent', class extends HTMLElement {
    connectedCallback() {
      init(this, () => {
        return () => {
          renders++;
          return html`<x-copying .items=${parent.items.map((item) => item)}></x-copying>`;
        };
      });
    }
  });
  const element = dom.window.document.createElement('x-parent');
  dom.window.document.body.append(element);
  for (let i = 0; i < 3; i++) await frame();
  assert.equal(element.querySelector('x-copying').items.join(), 'a,b', 'CONTROL: the property was set');
  const settled = renders;
  for (let i = 0; i < 20; i++) await frame();
  assert.equal(renders, settled, `an idle page renders nothing more (${settled} → ${renders} over 20 frames)`);
  parent.items = ['c'];
  for (let i = 0; i < 3; i++) await frame();
  assert.equal(element.querySelector('x-copying').items.join(), 'c', 'and the parent still renders on its OWN state');
  element.remove();
});
