/**
 * An async component that stays suspended long enough for something else to be rendered during its
 * window — which is the point of `tests/ssr-concurrency-stress.test.mjs`'s mixed-entry-point case.
 *
 * A timer rather than `await Promise.resolve()`, because a microtask does not leave a gap a
 * synchronous render can be fired into: the whole render would finish before the test got a turn.
 */
import { init, html } from '@verajs/core';

export default class SlowLifecycleSsr extends HTMLElement {
  async connectedCallback() {
    await new Promise((resolve) => setTimeout(resolve, 25)); // before init(): setup is synchronous (no-owner)
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<p>slow, and complete</p>`;
    });
  }
}
customElements.define('slow-lifecycle-ssr', SlowLifecycleSsr);
