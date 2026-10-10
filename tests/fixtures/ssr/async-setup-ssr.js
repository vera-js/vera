/**
 * Async setups as a server meets them (tests/core-setup-async-ssr): every shape a hand-written class can take — none uses
 * `define`, so what is pinned is core's own `customElements.define` wrapper, which every class defined after core goes
 * through. Each setup resolves on a TIMER, so a server that drains only microtasks would serve it empty.
 */
import { init, html } from '@verajs/core';

const later = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A sync connectedCallback, no return: the common hand-written shape. */
customElements.define('as-card', class extends HTMLElement {
  connectedCallback() {
    init(this, async () => {
      await later(20);
      return () => html`<p>card</p>`;
    });
  }
});

/** An async connectedCallback whose own promise settles BEFORE its inner setup does. */
customElements.define('as-own', class extends HTMLElement {
  async connectedCallback() {
    init(this, async () => {
      await later(30);
      return () => html`<p>own</p>`;
    });
    await later(5);
  }
});

/** A sync connectedCallback that returns a value out of habit. */
customElements.define('as-value', class extends HTMLElement {
  connectedCallback() {
    init(this, async () => {
      await later(20);
      return () => html`<p>value</p>`;
    });
    return this;
  }
});

/** Nested: an async parent whose resolved render holds an async child. */
customElements.define('as-parent', class extends HTMLElement {
  connectedCallback() {
    init(this, async () => {
      await later(10);
      return () => html`<section><as-card></as-card></section>`;
    });
  }
});

/** Slower than the test's `timeout`. */
customElements.define('as-slow', class extends HTMLElement {
  connectedCallback() {
    init(this, async () => {
      await later(400);
      return () => html`<p>slow</p>`;
    });
  }
});

/** A setup that rejects. */
customElements.define('as-reject', class extends HTMLElement {
  connectedCallback() {
    init(this, async () => {
      await later(10);
      throw new Error('the fetch failed');
    });
  }
});
