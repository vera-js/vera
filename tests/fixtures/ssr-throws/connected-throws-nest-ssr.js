/** A healthy component holding one whose `connectedCallback` throws: the INNER tag is the one named. */
import './connected-throws-ssr.js';
export default class ConnectedThrowsNestSsr extends HTMLElement {
  connectedCallback() {
    this.innerHTML = '<p>before</p><connected-throws-ssr></connected-throws-ssr>';
  }
}
customElements.define('connected-throws-nest-ssr', ConnectedThrowsNestSsr);
