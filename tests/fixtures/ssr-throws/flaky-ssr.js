/** A component that throws in `connectedCallback` only while `globalThis.flakySsrThrows` is set: one render fails, the next succeeds. */
export default class FlakySsr extends HTMLElement {
  connectedCallback() {
    if (globalThis.flakySsrThrows) throw new Error('boom-flaky');
    this.append('ok');
  }
}
customElements.define('flaky-ssr', FlakySsr);
