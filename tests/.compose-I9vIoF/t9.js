import { init, createStore, render, html } from '@verajs/core';
customElements.define('cp-s88r0-1', class extends HTMLElement {
  connectedCallback() {
    init(this);
    const state = createStore({ n: 2 });
    render(() => html`<div class="cp-s88r0-1" data-n=${state.n}><i>leaf cp-s88r0-1</i></div>`);
  }
});
customElements.define('cp-s88r0-0', class extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ n: 2 });
    render(() => html`<div class="cp-s88r0-0" data-n=${state.n}><cp-s88r0-1></cp-s88r0-1></div>`);
  }
});
export default customElements.get('cp-s88r0-0');
