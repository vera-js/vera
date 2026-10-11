import { init, html } from '@verajs/core';

/** A child whose setter THROWS — the component's own error, and it must stay one, named. */
class ThrowingChild extends HTMLElement {
  set strict(value) {
    throw new Error(`unacceptable: ${String(value)}`);
  }
  get strict() {
    return 'never';
  }
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<p>${this.strict}</p>`;
    });
  }
}
customElements.define('throwing-child', ThrowingChild);

class ThrowingParent extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<throwing-child .strict=${'nope'}></throwing-child>`;
    });
  }
}
customElements.define('throwing-parent', ThrowingParent);
export default ThrowingParent;
