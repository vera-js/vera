import { init, render, html } from '@verajs/core';

/** A child whose bound property has only a getter — assignment throws, and the error must name it. */
class ReadonlyChild extends HTMLElement {
  get locked() {
    return 'immutable';
  }
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<p>${this.locked}</p>`);
  }
}
customElements.define('readonly-child', ReadonlyChild);

class ReadonlyParent extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<readonly-child .locked=${'overwrite'}></readonly-child>`);
  }
}
customElements.define('readonly-parent', ReadonlyParent);
export default ReadonlyParent;
