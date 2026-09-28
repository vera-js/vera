import { init, render, html } from '@verajs/core';
import { css } from '@verajs/styles';

/** A LIGHT-DOM component whose CSS tries to close the page shell's <style> — its styles are hoisted. */
export default class StylesBreakoutSsr extends HTMLElement {
  static styles = css`.p { color: red } </style><script>alert(1)</script><style>`;
  connectedCallback() {
    init(this);
    render(() => html`<p class="p">x</p>`);
  }
}
customElements.define('styles-breakout-ssr', StylesBreakoutSsr);
