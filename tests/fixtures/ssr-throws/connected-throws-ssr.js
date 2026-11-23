/** A component whose own `connectedCallback` throws (no frame, no hook): the server must name it. */
export const THROWN = new Error('boom-connected');
export default class ConnectedThrowsSsr extends HTMLElement {
  connectedCallback() {
    throw THROWN;
  }
}
customElements.define('connected-throws-ssr', ConnectedThrowsSsr);
