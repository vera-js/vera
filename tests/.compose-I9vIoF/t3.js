import { init, createStore, render, html } from '@verajs/core';
customElements.define('cp-s21r0-2', class extends HTMLElement {
  connectedCallback() {
    init(this);
    const state = createStore({ n: 3 });
    render(() => html`<div class="cp-s21r0-2" data-n=${state.n}><i>leaf cp-s21r0-2</i></div>`);
  }
});
customElements.define('cp-s21r0-3', class extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ n: 4 });
    render(() => html`<div class="cp-s21r0-3" data-n=${state.n}><i>leaf cp-s21r0-3</i></div>`);
  }
});
customElements.define('cp-s21r0-1', class extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ n: 4 });
    render(() => html`<div class="cp-s21r0-1" data-n=${state.n}><cp-s21r0-2></cp-s21r0-2><cp-s21r0-3></cp-s21r0-3></div>`);
  }
});
customElements.define('cp-s21r0-5', class extends HTMLElement {
  connectedCallback() {
    init(this);
    const state = createStore({ n: 6 });
    render(() => html`<div class="cp-s21r0-5" data-n=${state.n}><i>leaf cp-s21r0-5</i></div>`);
  }
});
customElements.define('cp-s21r0-6', class extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ n: 7 });
    render(() => html`<div class="cp-s21r0-6" data-n=${state.n}><i>leaf cp-s21r0-6</i></div>`);
  }
});
customElements.define('cp-s21r0-4', class extends HTMLElement {
  connectedCallback() {
    init(this);
    const state = createStore({ n: 7 });
    render(() => html`<div class="cp-s21r0-4" data-n=${state.n}><cp-s21r0-5></cp-s21r0-5><cp-s21r0-6></cp-s21r0-6></div>`);
  }
});
customElements.define('cp-s21r0-0', class extends HTMLElement {
  connectedCallback() {
    init(this);
    const state = createStore({ n: 7 });
    render(() => html`<div class="cp-s21r0-0" data-n=${state.n}><cp-s21r0-1></cp-s21r0-1><cp-s21r0-4></cp-s21r0-4></div>`);
  }
});
export default customElements.get('cp-s21r0-0');
