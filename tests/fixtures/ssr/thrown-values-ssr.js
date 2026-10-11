import { init, html } from '@verajs/core';

/** Setters that throw values that are not errors — see `tests/ssr-thrown-values.test.mjs`. */
class ThrowsNull extends HTMLElement {
  set item(value) {
    throw null;
  }
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<p>null</p>`;
    });
  }
}
class ThrowsUndefined extends HTMLElement {
  set boom(value) {
    throw undefined;
  }
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<p>undefined</p>`;
    });
  }
}
class BindsThrower extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<throws-undefined .boom=${1}></throws-undefined>`;
    });
  }
}
customElements.define('throws-null', ThrowsNull);
customElements.define('throws-undefined', ThrowsUndefined);
customElements.define('binds-thrower', BindsThrower);
export default ThrowsNull;
