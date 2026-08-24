import { init, render } from '@verajs/core';
customElements.define('ret-null', class extends HTMLElement {
  connectedCallback() { init(this, { mode: 'open' }); render(() => null); }
});
customElements.define('ret-string', class extends HTMLElement {
  connectedCallback() { init(this, { mode: 'open' }); render(() => '<b>raw string</b>'); }
});
customElements.define('ret-number', class extends HTMLElement {
  connectedCallback() { init(this, { mode: 'open' }); render(() => 42); }
});
customElements.define('ret-throws', class extends HTMLElement {
  connectedCallback() { init(this, { mode: 'open' }); render(() => { throw new Error('template blew up'); }); }
});
export default customElements.get('ret-null');
