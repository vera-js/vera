/**
 * State an ancestor rendered, written by a descendant while the descendant sets up. The server writes a page top-down
 * in one pass, so the ancestor's markup is already written when the write lands: `<order-parent-ssr>` serves the value
 * it read, and its child serves the value it wrote. `<order-settled-ssr>` writes the same state in its own setup, before
 * it renders, and serves the written value. Built for `tests/ssr-render-order.test.mjs`.
 */
import { init, html, signal } from '@verajs/core';

const count = signal(0);

customElements.define('order-kid-ssr', class extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      count.value = 1;
      return () => html`<b>${count.value}</b>`;
    });
  }
});

customElements.define('order-parent-ssr', class extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      count.value = 0;
      return () => html`<span>${count.value}</span><order-kid-ssr></order-kid-ssr>`;
    });
  }
});

customElements.define('order-settled-ssr', class extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      count.value = 0;
      count.value = 1;
      return () => html`<span>${count.value}</span><order-kid-ssr></order-kid-ssr>`;
    });
  }
});
