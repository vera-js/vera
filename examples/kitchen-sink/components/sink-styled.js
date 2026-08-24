/**
 * `static styles` into a shadow root — constructed sheets on `adoptedStyleSheets`.
 *
 * The sheet is adopted once and shared by every instance, so what varies goes in a custom property:
 * `var()` re-resolves when one changes and inherits through the shadow boundary, which is the whole
 * reason the docs say `static styles` need not be reactive. Both halves are exercised here.
 */
import { init, render, html, css, createStore } from '@verajs/core';

export default class SinkStyled extends HTMLElement {
  static styles = css`
    :host {
      display: block;
    }
    .badge {
      color: var(--sink-accent, rebeccapurple);
      border: 1px solid currentColor;
    }
    /* A child selector and an attribute selector: both are corrupted by escaping CSS as markup. */
    .badge > .inner[data-kind='pill'] {
      border-radius: 999px;
    }
  `;

  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ accent: 'teal' });
    this.state = state;

    render(
      () => html`<div id="styled" style="--sink-accent: ${state.accent}">
        <span class="badge"><span class="inner" data-kind="pill">styled</span></span>
      </div>`
    );
  }
}

customElements.define('sink-styled', SinkStyled);
