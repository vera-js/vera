/**
 * Three controls named through `@vera-hooks/labeled`, which gives each label a generated id from the counter every copy
 * of the library shares (`Symbol.for('vera.uid')`): what a server render must number the same way every time.
 */
import { define, effect, html, init } from '@verajs/core';
import { labeled } from '@vera-hooks/labeled';

class SsrUidField extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      effect(
        () => {
          const root = this.shadowRoot;
          labeled(root.querySelector('input'), { host: this, label: root.querySelector('span') });
        },
        { timing: 'layout' }
      );
      return () => html`<span>Name</span><input>`;
    });
  }
}
customElements.define('ssr-uid-field', SsrUidField);

export default define('ssr-uid-page', () => () => html`<ssr-uid-field></ssr-uid-field><ssr-uid-field></ssr-uid-field><ssr-uid-field></ssr-uid-field>`);
