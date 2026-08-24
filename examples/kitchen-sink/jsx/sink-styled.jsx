/**
 * The JSX twin of `../components/sink-styled.js`.
 *
 * `style` must be a **string** in JSX — an object is a compile error — which is the one place the
 * two authoring styles are written differently for the same result.
 */
import { init, render, css, createStore } from '@verajs/core';

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
    render(() => (
      <div id="styled" style={`--sink-accent: ${state.accent}`}>
        <span className="badge"><span className="inner" data-kind="pill">styled</span></span>
      </div>
    ));
  }
}

customElements.define('sink-styled', SinkStyled);
