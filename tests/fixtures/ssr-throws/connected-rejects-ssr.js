/**
 * An async `connectedCallback` that rejects after a microtask, placed BEFORE a sibling: by the time it rejects, the
 * sibling has been prepared, so the tag "being rendered" is the sibling's. The rejecting one must still be named.
 */
export const REJECTED = new Error('boom-async');
class ConnectedRejectsSsr extends HTMLElement {
  async connectedCallback() {
    await Promise.resolve();
    throw REJECTED;
  }
}
customElements.define('connected-rejects-ssr', ConnectedRejectsSsr);
class ConnectedSiblingSsr extends HTMLElement {
  async connectedCallback() {
    await new Promise((resolve) => setTimeout(resolve, 5));
    this.textContent = 'sibling';
  }
}
customElements.define('connected-sibling-ssr', ConnectedSiblingSsr);
export default class ConnectedRejectsNestSsr extends HTMLElement {
  connectedCallback() {
    this.innerHTML = '<connected-rejects-ssr></connected-rejects-ssr><connected-sibling-ssr></connected-sibling-ssr>';
  }
}
customElements.define('connected-rejects-nest-ssr', ConnectedRejectsNestSsr);
