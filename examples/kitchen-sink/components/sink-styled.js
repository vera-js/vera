/**
 * `static styles` into a shadow root — constructed sheets on `adoptedStyleSheets`.
 *
 * The sheet is adopted once and shared by every instance, so what varies goes in a custom property:
 * `var()` re-resolves when one changes and inherits through the shadow boundary, which is the whole
 * reason the docs say `static styles` need not be reactive. Both halves are exercised here.
 */
import { init, render, html, css, createStore } from '@verajs/core';

/** Cycled by the button below; `var()` re-resolves without the sheet being touched. */
const ACCENTS = ['teal', 'crimson', 'rebeccapurple', 'darkorange'];

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
    let tint = 0;

    render(
      () => html`<div id="styled" style="--sink-accent: ${state.accent}">
        <h2>static styles</h2>
        <p class="hint">The sheet is adopted once and never re-adopted — what changes is a custom property.</p>
        <button id="tint" @click=${() => (state.accent = ACCENTS[++tint % ACCENTS.length])}>re-tint (${state.accent})</button>
        <span class="badge"><span class="inner" data-kind="pill">styled</span></span>
      </div>`
    );
  }
}

customElements.define('sink-styled', SinkStyled);
