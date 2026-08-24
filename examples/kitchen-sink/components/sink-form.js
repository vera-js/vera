/**
 * A form-associated custom element, an observed attribute, and `hold()`.
 *
 * `static formAssociated` + `attachInternals()` is the standard way to write a custom control, and
 * `attributeChangedCallback` is the only reactive-attribute mechanism a plain custom element has —
 * both were absent server-side until recently, which made every component written this way render
 * its initial state into the page. `hold()` keeps the toggled-away subtree alive so anything the
 * user typed into it survives, which is a client-only guarantee stated as one.
 */
import { init, render, html, createStore } from '@verajs/core';
import { hold } from '@verajs/renderer';

export default class SinkForm extends HTMLElement {
  static formAssociated = true;
  static observedAttributes = ['label', 'value'];

  /**
   * `attributeChangedCallback` fires **before** `connectedCallback` — that is the whole point of it
   * — so the log cannot be a class field or a `connectedCallback` assignment. It is created on
   * first use, which is the shape a custom element needs whenever an observed attribute is
   * involved.
   */
  attributeChangedCallback(name, previous, value) {
    (this.seen ??= []).push(`${name}:${previous}>${value}`);
    if (this.state) this.state.log = this.seen.join('|');
  }

  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ editing: false, log: (this.seen ??= []).join('|') });
    this.state = state;
    this.internals = this.attachInternals();
    this.internals.setFormValue(this.getAttribute('value') ?? '');
    this.toggle = () => (state.editing = !state.editing);

    render(
      () => html`<section id="form">
        <h2>hold() and observed attributes</h2>
        <p class="hint">Type into the editor, toggle away and back: hold() keeps what you typed.</p>
        <button id="doToggle" @click=${() => this.toggle()}>${state.editing ? 'show the value' : 'edit'}</button>
        <button id="doRename" @click=${() => this.setAttribute('label', `Renamed ${(this.seen ?? []).length}`)}>
          change the observed attribute
        </button>
        <p>label: <span id="label">${this.getAttribute('label')}</span></p>
        <p id="log">${state.log}</p>
        <div id="held">
          ${hold(
            state.editing
              ? html`<input id="editor" .value=${this.getAttribute('value') ?? ''} />`
              : html`<output id="viewer">${this.getAttribute('value') ?? ''}</output>`
          )}
        </div>
      </section>`
    );
  }
}

customElements.define('sink-form', SinkForm);
