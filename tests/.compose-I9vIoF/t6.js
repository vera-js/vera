import { init, createStore, render, html } from '@verajs/core';
customElements.define('cp-s47r0-1', class extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ n: 2 });
    render(() => html`<div class="cp-s47r0-1" data-n=${state.n}><i>leaf cp-s47r0-1</i></div>`);
  }
});
customElements.define('cp-s47r0-0', class extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ n: 2 });
    render(() => html`<div class="cp-s47r0-0" data-n=${state.n}><cp-s47r0-1></cp-s47r0-1></div>`);
  }
});
export default customElements.get('cp-s47r0-0');
