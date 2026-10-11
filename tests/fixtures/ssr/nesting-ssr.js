import { init, html } from '@verajs/core';
/** Light inside shadow, shadow inside light, and a component rendering a sibling of itself. */
customElements.define('n-light', class extends HTMLElement {
  connectedCallback() { init(this, () => {
    return () => html`<span><n-shadow></n-shadow></span>`;
  }); }
});
customElements.define('n-shadow', class extends HTMLElement {
  connectedCallback() { init({ host: this, shadow: 'open' }, () => {
    return () => html`<em><n-leaf></n-leaf></em>`;
  }); }
});
customElements.define('n-leaf', class extends HTMLElement {
  connectedCallback() { init(this, () => {
    return () => html`leaf`;
  }); }
});
export default class NestingSsr extends HTMLElement {
  connectedCallback() { init({ host: this, shadow: 'open' }, () => {
    return () => html`<div><n-light></n-light></div>`;
  }); }
}
customElements.define('nesting-ssr', NestingSsr);
