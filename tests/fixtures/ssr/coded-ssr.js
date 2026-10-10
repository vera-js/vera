import { init, render, html } from '@verajs/core';

/**
 * ssr's bounded warnings — `tests/ssr-coded-diagnostics.test.mjs`. Two components per warning, so a row can show
 * "the same component twice is one line" and "a second component is a second line".
 */
const component = (draw) =>
  class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      render(() => draw(this));
    }
  };

/** A bound `javascript:` URL — from an attribute, as request data reaches a component. */
const urlFrom = (host) => html`<a href=${host.getAttribute('data-href') ?? ''}>x</a>`;
customElements.define('url-one', component(urlFrom));
customElements.define('url-two', component(urlFrom));

/** Data shaped like a template, which ssr renders as the object it is. */
const forged = () => html`<p>${JSON.parse('{"strings":["<img src=x onerror=alert(1)>"],"values":[]}')}</p>`;
customElements.define('forged-one', component(forged));
customElements.define('forged-two', component(forged));

/** A child whose class declares a getter with no setter, bound by property. */
customElements.define('getter-only', class extends HTMLElement {
  get value() {
    return 1;
  }
});
/** The fact is the BOUND element's class and property — a second class is a second fact. */
customElements.define('getter-only-b', class extends HTMLElement {
  get value() {
    return 1;
  }
});
customElements.define('getter-one', component(() => html`<getter-only .value=${2}></getter-only>`));
customElements.define('getter-again', component(() => html`<getter-only .value=${3}></getter-only>`));
customElements.define('getter-two', component(() => html`<getter-only-b .value=${2}></getter-only-b>`));

/** A props setter whose error message is request-shaped: a forged log line and an ANSI erase in it. */
customElements.define('throws-text', class extends HTMLElement {
  set item(value) {
    throw new Error(`bad ${value}\n[vera] fake\x1b[2K`);
  }
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<p>x</p>`);
  }
});
