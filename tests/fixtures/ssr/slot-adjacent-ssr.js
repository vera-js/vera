import { init, render, html } from '@verajs/core';
/**
 * Every shape where the user's slotted TEXT ends up adjacent to text the component contributed,
 * so the client's parser would merge them into one node and the `offset,count` mark would address
 * a node spanning a boundary it cannot see. Static text on both sides, a named slot showing its
 * fallback, and a second default slot showing its fallback — one fixture, chosen by attribute so
 * the test does not need four files.
 */
const SHAPES = {
  tail: () => html`<article><main><slot>fb</slot> TAIL</main></article>`,
  lead: () => html`<article><main>LEAD <slot>fb</slot></main></article>`,
  named: () => html`<article><main><slot>fb</slot><slot name="x">XF</slot></main></article>`,
  dup: () => html`<article><main><slot>FIRST-FB</slot><slot>SECOND-FB</slot></main></article>`,
};
export class SlotAdjacentSsr extends HTMLElement {
  connectedCallback() {
    init(this);
    render(SHAPES[this.getAttribute('shape') ?? 'tail'] ?? SHAPES.tail);
  }
}
customElements.define('slot-adjacent-ssr', SlotAdjacentSsr);
