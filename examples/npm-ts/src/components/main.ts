/**
 * The app shell. Nothing here is special — it renders one template and lets the autoloader bring in
 * everything the markup names.
 *
 * It used to call `hydrate` from `@lit-labs/ssr-client` before rendering, alongside a commented-out
 * block wiring lit's SSR renderer. Both went with the move to `@verajs/renderer`, and neither was
 * doing anything: the call handed lit a FUNCTION where it wants a `TemplateResult`, and `render`
 * ran immediately afterwards regardless. Hydration in this framework is `@verajs/renderer/hydrate`,
 * exercised for real by `examples/ssr-node` and the browser suite's fixtures.
 */
import { html, init, render, useEffect } from '@verajs/core';

import './parent-element.js';
import './child-element.js';
import './quantity-picker.js';
import './name-acquire.js';
import './wcc-single-element.js';

class MainElement extends HTMLElement {
  connectedCallback() {
    init(this);
    useEffect(() => {});

    const template = () => {
      return html`<parent-element><div>HI FRIENDS!!</div></parent-element>`;
    };

    render(template);
  }
}
export default MainElement;

customElements.define('main-element', MainElement);
