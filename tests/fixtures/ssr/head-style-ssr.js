/**
 * A component that appends its own `<style>` to `document.head` on **every** render, rather than
 * using `static styles`. That is the shape the once-per-render hoisting guard exists for: without
 * it the sheets accumulate per process, and request thirty ships twenty-nine other requests' CSS.
 *
 * Built for `tests/ssr-concurrency-stress.test.mjs` after `static styles` fixtures turned out to be
 * unable to see that state at all — `@verajs/styles` hoists once per class ever, so it reaches the
 * guard exactly once and a leak in it changes nothing.
 */
import { init, render, html } from '@verajs/core';

export default class HeadStyleSsr extends HTMLElement {
  connectedCallback() {
    init(this);
    /**
     * **The CSS differs per request**, which is what makes a leak of the hoisting state visible at
     * all: `hoist` de-duplicates by text, so a component emitting the *same* stylesheet every time
     * cannot show the defect. A request whose colour is its own is the only shape where "request
     * two carried request one's CSS" is a statement you can check.
     */
    const tone = this.getAttribute('tone') ?? 'teal';
    render(() => {
      const style = document.createElement('style');
      style.textContent = `.head-style { color: ${tone} }`;
      document.head.appendChild(style);
      return html`<p class="head-style">${tone}</p>`;
    });
  }
}
customElements.define('head-style-ssr', HeadStyleSsr);
