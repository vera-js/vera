import { init, html } from '@verajs/core';
export default class RenderThrowsSsr extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      return () => {
        throw new Error('render blew up');
        /** eslint wants the template to be reachable; the throw is the point. */
        // eslint-disable-next-line no-unreachable
        return html`<p>never</p>`;
      };
    });
  }
}
customElements.define('render-throws-ssr', RenderThrowsSsr);
