import { init, render, html, css } from '@verajs/core';
customElements.define('shared-badge', class extends HTMLElement {
  static styles = css`.badge { color: gold }`;
  connectedCallback() { init(this); render(() => html`<span class="badge">!</span>`); }
});
export default class IslandASsr extends HTMLElement {
  static styles = css`.a { color: red }`;
  connectedCallback() { init(this); render(() => html`<div class="a"><shared-badge></shared-badge></div>`); }
}
customElements.define('island-a-ssr', IslandASsr);
