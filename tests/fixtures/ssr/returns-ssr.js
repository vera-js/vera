import { init } from '@verajs/core';
customElements.define('ret-null', class extends HTMLElement {
  connectedCallback() { init({ host: this, shadow: 'open' }, () => {
    return () => null;
  }); }
});
customElements.define('ret-string', class extends HTMLElement {
  connectedCallback() { init({ host: this, shadow: 'open' }, () => {
    return () => '<b>raw string</b>';
  }); }
});
customElements.define('ret-number', class extends HTMLElement {
  connectedCallback() { init({ host: this, shadow: 'open' }, () => {
    return () => 42;
  }); }
});
customElements.define('ret-throws', class extends HTMLElement {
  connectedCallback() { init({ host: this, shadow: 'open' }, () => {
    return () => { throw new Error('template blew up'); };
  }); }
});
export default customElements.get('ret-null');
