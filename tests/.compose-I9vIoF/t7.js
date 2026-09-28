import { init, createStore, render, html } from '@verajs/core';
customElements.define('cp-s47r1-2', class extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ n: 3 });
    render(() => html`<div class="cp-s47r1-2" data-n=${state.n}><i>leaf cp-s47r1-2</i></div>`);
  }
});
customElements.define('cp-s47r1-3', class extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ n: 4 });
    render(() => html`<div class="cp-s47r1-3" data-n=${state.n}><i>leaf cp-s47r1-3</i></div>`);
  }
});
customElements.define('cp-s47r1-1', class extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ n: 4 });
    render(() => html`<div class="cp-s47r1-1" data-n=${state.n}><cp-s47r1-2></cp-s47r1-2><cp-s47r1-3></cp-s47r1-3></div>`);
  }
});
customElements.define('cp-s47r1-0', class extends HTMLElement {
  connectedCallback() {
    init(this);
    const state = createStore({ n: 4 });
    render(() => html`<div class="cp-s47r1-0" data-n=${state.n}><cp-s47r1-1></cp-s47r1-1></div>`);
  }
});
export default customElements.get('cp-s47r1-0');
