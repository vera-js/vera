import { init, render, html, css } from '@verajs/core';
import './island-a-ssr.js';
export default class IslandBSsr extends HTMLElement {
  static styles = css`.b { color: blue }`;
  connectedCallback() { init(this); render(() => html`<div class="b"><shared-badge></shared-badge></div>`); }
}
customElements.define('island-b-ssr', IslandBSsr);
