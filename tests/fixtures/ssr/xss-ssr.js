/**
 * SSR fixture carrying hostile values in every position a template can bind.
 *
 * The client renderer cannot be attacked this way — `setAttribute` and `textContent` do not parse
 * markup, so the value is inert by construction. The server has no such guarantee: it builds a
 * string, and an unescaped quote in an attribute closes it and opens a new one. That asymmetry is
 * why principle #8 calls out server/client escaping mismatches by name.
 */
import { init, createStore, render, html } from '@verajs/core';

export const PAYLOAD = {
  text: '<img src=x onerror=alert(1)>',
  attribute: '" onload="alert(1)" x="',
  singleQuoted: "' onload='alert(1)' x='",
};

export default class XssSsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ ...PAYLOAD });

    render(
      () => html`
        <p>${state.text}</p>
        <div title=${state.attribute}>attribute position</div>
        <div data-x="${state.singleQuoted}">quoted attribute position</div>
        <input .value=${state.attribute} />
      `
    );
  }
}

customElements.define('xss-ssr', XssSsr);
