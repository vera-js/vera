import { init, createStore, render, html } from '@verajs/core';
customElements.define('cp-s5r0-2', class extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ n: 3 });
    render(() => html`<div class="cp-s5r0-2" data-n=${state.n}><i>leaf cp-s5r0-2</i></div>`);
  }
});
customElements.define('cp-s5r0-3', class extends HTMLElement {
  connectedCallback() {
    init(this);
    const state = createStore({ n: 4 });
    render(() => html`<div class="cp-s5r0-3" data-n=${state.n}><i>leaf cp-s5r0-3</i></div>`);
  }
});
customElements.define('cp-s5r0-1', class extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ n: 4 });
    render(() => html`<div class="cp-s5r0-1" data-n=${state.n}><cp-s5r0-2></cp-s5r0-2><cp-s5r0-3></cp-s5r0-3></div>`);
  }
});
customElements.define('cp-s5r0-0', class extends HTMLElement {
  connectedCallback() {
    init(this);
    const state = createStore({ n: 4 });
    render(() => html`<div class="cp-s5r0-0" data-n=${state.n}><cp-s5r0-1></cp-s5r0-1></div>`);
  }
});
export default customElements.get('cp-s5r0-0');
