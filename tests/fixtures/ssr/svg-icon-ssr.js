/**
 * SSR fixture: the shape `@verajs/jsx` emits for an icon handed to a wrapper component.
 *
 * Written as the COMPILED output rather than as JSX, because that is what an app actually ships and
 * what the server is handed: a component's children arrive as an array of separate templates, each
 * already tagged where it was written. `<title>` is in that array as `` svg`…` `` only because a
 * sibling vouched for it — a root tag alone cannot prove SVG context, and SVG shares the name with
 * HTML.
 *
 * It exists because nothing else in the gate carries this shape through the server. What it proves
 * is narrower than it first looks, and the browser suite says so: `@verajs/ssr` emits BYTE-IDENTICAL
 * markup whether these children were tagged `` svg`…` `` or `` html`…` ``, because the server writes
 * a template's STRINGS and the browser's parser assigns namespaces from structure. The compile-time
 * tag decides what `createElementNS` does on the CLIENT and has no effect here.
 */
import { init, render, html, svg } from '@verajs/core';

const Frame = ({ children }) => html`<svg viewBox="0 0 24 24" width="24" height="24">${children}</svg>`;

export default class SvgIconSsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(
      () => html`
        <figure class="icon">
          ${Frame({
            children: [
              svg`<title>Close</title>`,
              svg`<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" fill="none"></path>`,
              svg`<circle cx="12" cy="12" r="11" fill="none"></circle>`,
            ],
          })}
        </figure>
      `
    );
  }
}

customElements.define('svg-icon-ssr', SvgIconSsr);
