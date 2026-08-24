/**
 * The JSX twin of `../components/sink-styled.js`.
 *
 * `style` must be a **string** in JSX — an object is a compile error — which is the one place the
 * two authoring styles are written differently for the same result.
 */
import { init, render, css, createStore } from '@verajs/core';

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
    .badge > .inner[data-kind='pill'] {
      border-radius: 999px;
    }
  `;

  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ accent: 'teal' });
    this.state = state;
    let tint = 0;
    render(() => (
      <div id="styled" style={`--sink-accent: ${state.accent}`}>
        <h2>Styles, in a shadow root</h2>
        <h3>A constructed stylesheet adopted once per element and shared by every instance of the class</h3>
        <h4>Press re-tint: the colour changes through a custom property, and the sheet is never re-adopted.</h4>
        <button id="tint" onClick={() => (state.accent = ACCENTS[++tint % ACCENTS.length])}>re-tint ({state.accent})</button>
        <span className="badge"><span className="inner" data-kind="pill">styled</span></span>
      </div>
    ));
  }
}

customElements.define('sink-styled', SinkStyled);
