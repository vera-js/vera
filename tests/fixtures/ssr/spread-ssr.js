import { init, render, html } from '@verajs/core';
import { spread } from '@verajs/spread';

export default class SpreadSsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(
      () => html`<input ${spread({
        id: 'field',
        '?disabled': true,
        '?readonly': false,
        '.value': 'from the server',
        '.internalState': { not: 'markup' },
        onClick: () => {},
        title: '" onload="alert(1)',
      })} />`
    );
  }
}
customElements.define('spread-ssr', SpreadSsr);
