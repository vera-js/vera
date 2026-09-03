/** Three levels of light-slot components, each slotting the next — composition, not just nesting. */
import { init, render, html } from '@verajs/core';

class DeepC extends HTMLElement {
  connectedCallback() {
    init(this);
    render(() => html`<c><slot name="x">no-c</slot></c>`);
  }
}
customElements.define('deep-c', DeepC);

class DeepB extends HTMLElement {
  connectedCallback() {
    init(this);
    render(() => html`<b1><slot name="x">no-b</slot></b1><b2><slot>no-b-default</slot></b2>`);
  }
}
customElements.define('deep-b', DeepB);

export class DeepA extends HTMLElement {
  /** Async on purpose: the awaited chain has to reach the same answer as the synchronous one. */
  async connectedCallback() {
    init(this);
    await Promise.resolve();
    render(() => html`<a1><slot name="x">no-a</slot></a1><a2><slot>no-a-default</slot></a2>`);
  }
}
customElements.define('deep-a', DeepA);
