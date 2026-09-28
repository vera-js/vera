import { init, createStore, render, html } from '@verajs/core';
customElements.define('cp-s150r0-2', class extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ n: 3 });
    render(() => html`<div class="cp-s150r0-2" data-n=${state.n}><i>leaf cp-s150r0-2</i></div>`);
  }
});
customElements.define('cp-s150r0-1', class extends HTMLElement {
  connectedCallback() {
    init(this);
    const state = createStore({ n: 3 });
    render(() => html`<div class="cp-s150r0-1" data-n=${state.n}><cp-s150r0-2></cp-s150r0-2></div>`);
  }
});
customElements.define('cp-s150r0-4', class extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ n: 5 });
    render(() => html`<div class="cp-s150r0-4" data-n=${state.n}><i>leaf cp-s150r0-4</i></div>`);
  }
});
customElements.define('cp-s150r0-3', class extends HTMLElement {
  connectedCallback() {
    init(this);
    const state = createStore({ n: 5 });
    render(() => html`<div class="cp-s150r0-3" data-n=${state.n}><cp-s150r0-4></cp-s150r0-4></div>`);
  }
});
customElements.define('cp-s150r0-0', class extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ n: 5 });
    render(() => html`<div class="cp-s150r0-0" data-n=${state.n}><cp-s150r0-1></cp-s150r0-1><cp-s150r0-3></cp-s150r0-3></div>`);
  }
});
export default customElements.get('cp-s150r0-0');
