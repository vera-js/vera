/**
 * SSR fixture: a component that parses markup holding named references outside the six the decoder always knew, and
 * serves what the server DOM read back, so `tests/browser/ssr-worker.test.js` shows `@verajs/ssr/named-references`
 * loads and decodes inside a browser worker, wired by the component's module as an app's server entry would.
 */
import { init, html, wire } from '@verajs/core';
import { namedReferences } from '@verajs/ssr/named-references';

wire([namedReferences]);

export default class NamedRefSsr extends HTMLElement {
  connectedCallback() {
    const probe = document.createElement('div');
    probe.innerHTML = '<p>a&hellip;b &notin c</p>';
    const read = probe.textContent;
    init({ host: this, shadow: 'open' }, () => () => html`<output>${read}</output>`);
  }
}

customElements.define('named-ref-ssr', NamedRefSsr);
