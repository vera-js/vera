import { init, createStore, render, html } from '@verajs/core';
customElements.define('cp-s21r1-2', class extends HTMLElement {
  connectedCallback() {
    init(this);
    const state = createStore({ n: 3 });
    render(() => html`<div class="cp-s21r1-2" data-n=${state.n}><i>leaf cp-s21r1-2</i></div>`);
  }
});
customElements.define('cp-s21r1-3', class extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ n: 4 });
    render(() => html`<div class="cp-s21r1-3" data-n=${state.n}><i>leaf cp-s21r1-3</i></div>`);
  }
});
customElements.define('cp-s21r1-1', class extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ n: 4 });
    render(() => html`<div class="cp-s21r1-1" data-n=${state.n}><cp-s21r1-2></cp-s21r1-2><cp-s21r1-3></cp-s21r1-3></div>`);
  }
});
customElements.define('cp-s21r1-5', class extends HTMLElement {
  connectedCallback() {
    init(this);
    const state = createStore({ n: 6 });
    render(() => html`<div class="cp-s21r1-5" data-n=${state.n}><i>leaf cp-s21r1-5</i></div>`);
  }
});
customElements.define('cp-s21r1-4', class extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ n: 6 });
    render(() => html`<div class="cp-s21r1-4" data-n=${state.n}><cp-s21r1-5></cp-s21r1-5></div>`);
  }
});
customElements.define('cp-s21r1-0', class extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ n: 6 });
    render(() => html`<div class="cp-s21r1-0" data-n=${state.n}><cp-s21r1-1></cp-s21r1-1><cp-s21r1-4></cp-s21r1-4></div>`);
  }
});
export default customElements.get('cp-s21r1-0');
