/** A light component whose slot NAME would close a comment and open markup, were a name ever written into one. */
import { init, html } from '@verajs/core';
export class SlotHostileNameSsr extends HTMLElement {
  connectedCallback() {
    init(this, () => {
      return () => html`<header><slot name="a-->x<img src=x>">fb</slot></header>`;
    });
  }
}
customElements.define('slot-hostile-name-ssr', SlotHostileNameSsr);
