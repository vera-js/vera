/** A component whose `connectedCallback` throws an object with no prototype: no `toString`, so `String()` on it throws. */
export const BARE = Object.create(null);
export default class ConnectedThrowsBareSsr extends HTMLElement {
  connectedCallback() {
    throw BARE;
  }
}
customElements.define('connected-throws-bare-ssr', ConnectedThrowsBareSsr);
