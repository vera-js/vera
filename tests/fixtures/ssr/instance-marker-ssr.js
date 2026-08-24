/**
 * A component that builds a child imperatively and hands it data an attribute cannot carry.
 *
 * The fixture for the marker-hijack case: `children` is raw markup, so a caller passing request
 * data through it could otherwise write a marker claiming this child's prepared instance.
 */
import { init, render, html } from '@verajs/core';
class Secret extends HTMLElement {
  token = 'PUBLIC';
  connectedCallback() { init(this); render(() => html`<p>${this.token}</p>`); }
}
customElements.define('marker-secret-ssr', Secret);
class InstanceMarkerSsr extends HTMLElement {
  connectedCallback() {
    init(this);
    const kid = document.createElement('marker-secret-ssr');
    kid.token = 'SUPER-SECRET-SESSION-KEY';
    this.appendChild(kid);
  }
}
customElements.define('instance-marker-ssr', InstanceMarkerSsr);
export default InstanceMarkerSsr;
