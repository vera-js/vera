/** The commonest light-slot shape: an outer template binding TEXT into a light component — alone, and beside static text. */
import { init, html } from '@verajs/core';

class SlotLabelBtn extends HTMLElement {
  connectedCallback() {
    init(this, () => {
      return () => html`<button class="btn"><slot>no label</slot></button>`;
    });
  }
}
customElements.define('slot-label-btn', SlotLabelBtn);

export class SlotLabelSsr extends HTMLElement {
  connectedCallback() {
    init(this, () => {
      const label = 'Save', name = 'Ada';
      return () => html`<slot-label-btn>${label}</slot-label-btn><slot-label-btn>Hi ${name}!</slot-label-btn>`;
    });
  }
}
customElements.define('slot-label-ssr', SlotLabelSsr);
