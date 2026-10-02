import { init, render, html } from '@verajs/core';

/** Setters that throw values that are not errors — see `tests/ssr-thrown-values.test.mjs`. */
class ThrowsNull extends HTMLElement {
  set item(value) {
    throw null;
  }
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<p>null</p>`);
  }
}
class ThrowsUndefined extends HTMLElement {
  set boom(value) {
    throw undefined;
  }
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<p>undefined</p>`);
  }
}
class BindsThrower extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<throws-undefined .boom=${1}></throws-undefined>`);
  }
}
customElements.define('throws-null', ThrowsNull);
customElements.define('throws-undefined', ThrowsUndefined);
customElements.define('binds-thrower', BindsThrower);
export default ThrowsNull;
