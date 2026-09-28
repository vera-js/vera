import { init, createStore, render, html } from '@verajs/core';
customElements.define('cp-s88r2-2', class extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ n: 3 });
    render(() => html`<div class="cp-s88r2-2" data-n=${state.n}><i>leaf cp-s88r2-2</i></div>`);
  }
});
customElements.define('cp-s88r2-1', class extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ n: 3 });
    render(() => html`<div class="cp-s88r2-1" data-n=${state.n}><cp-s88r2-2></cp-s88r2-2></div>`);
  }
});
customElements.define('cp-s88r2-4', class extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ n: 5 });
    render(() => html`<div class="cp-s88r2-4" data-n=${state.n}><i>leaf cp-s88r2-4</i></div>`);
  }
});
customElements.define('cp-s88r2-3', class extends HTMLElement {
  connectedCallback() {
    init(this);
    const state = createStore({ n: 5 });
    render(() => html`<div class="cp-s88r2-3" data-n=${state.n}><cp-s88r2-4></cp-s88r2-4></div>`);
  }
});
customElements.define('cp-s88r2-0', class extends HTMLElement {
  connectedCallback() {
    init(this);
    const state = createStore({ n: 5 });
    render(() => html`<div class="cp-s88r2-0" data-n=${state.n}><cp-s88r2-1></cp-s88r2-1><cp-s88r2-3></cp-s88r2-3></div>`);
  }
});
export default customElements.get('cp-s88r2-0');
