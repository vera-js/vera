import { init, render, html } from '@verajs/core';

/** Reads back what its parent passed — the round trip the escaping has to survive. */
customElements.define(
  'attrs-child-ssr',
  class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      render(() => html`<p>${this.getAttribute('label')}</p>`);
    }
  }
);

/** Single-quoted, unquoted and valueless — all three forms an author may write in a static. */
customElements.define(
  'attrs-quotes-ssr',
  class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      render(() => html`<b>${this.getAttribute('a')}|${this.getAttribute('b')}|${this.getAttribute('c')}</b>`);
    }
  }
);

export default class AttrsParentSsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(
      () => html`
        <attrs-child-ssr label=${'Tom & Jerry <b>"quoted"'}></attrs-child-ssr>
        <attrs-quotes-ssr a='single' b=unquoted c></attrs-quotes-ssr>`
    );
  }
}
customElements.define('attrs-parent-ssr', AttrsParentSsr);
