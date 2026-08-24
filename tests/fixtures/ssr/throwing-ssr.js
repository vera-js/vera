import { init, render, html, css } from '@verajs/core';
export default class ThrowingSsr extends HTMLElement {
  static styles = css`.t { color: red }`;
  connectedCallback() { init(this); throw new Error('component blew up'); }
}
customElements.define('throwing-ssr', ThrowingSsr);
