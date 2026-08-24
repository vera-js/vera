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
    (this.seen ??= []).push({ name, previous, value });
    if (this.state) {
      this.state.latest = `${name}: ${previous ?? '(unset)'} → ${value}`;
      /** The last three, not everything: an unbounded string stops being readable after four presses. */
      this.state.log = this.seen
        .slice(-3)
        .map((entry) => `${entry.name}: ${entry.previous ?? '(unset)'} → ${entry.value}`)
        .join('  ·  ');
      this.state.calls = this.seen.length;
    }
  }

  connectedCallback() {
    init(this, { mode: 'open' });
    const seen = (this.seen ??= []);
    const describe = (entry) => `${entry.name}: ${entry.previous ?? '(unset)'} → ${entry.value}`;
    const state = createStore({
      editing: false,
      calls: seen.length,
      latest: seen.length ? describe(seen[seen.length - 1]) : '(none yet)',
      log: seen.slice(-3).map(describe).join('  ·  '),
    });
    this.state = state;
    let renames = 0;
    this.internals = this.attachInternals();
    this.internals.setFormValue(this.getAttribute('value') ?? '');
    this.toggle = () => (state.editing = !state.editing);

    render(
      () => html`<section id="form">
        <h2>Forms and held DOM</h2>
        <h3>hold() keeps a toggled-away subtree alive, and attributeChangedCallback is the only reactive-attribute mechanism a custom element has</h3>
        <h4>Press edit, type something, press show the value, then edit again — your text is still there.</h4>
        <button id="doToggle" @click=${() => this.toggle()}>${state.editing ? 'show the value' : 'edit'}</button>
        <button id="doRename" @click=${() => this.setAttribute('label', `Renamed ${++renames}`)}>change the observed attribute</button>
        <p>label: <span id="label">${this.getAttribute('label')}</span></p>
        <p>attributeChangedCallback fired <strong>${state.calls}</strong> times; most recent: <strong>${state.latest}</strong></p>
        <p class="note">last three: <span id="log">${state.log}</span></p>
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
