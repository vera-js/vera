import { init, html } from '@verajs/core';
import { css } from '@verajs/styles';
import './island-a-ssr.js';
export default class IslandBSsr extends HTMLElement {
  static styles = css`.b { color: blue }`;
  connectedCallback() { init(this, () => {
    return () => html`<div class="b"><shared-badge></shared-badge></div>`;
  }); }
}
customElements.define('island-b-ssr', IslandBSsr);
