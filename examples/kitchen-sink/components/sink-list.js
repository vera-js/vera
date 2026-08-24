/**
 * Keyed lists, and the reordering that only a keyed renderer survives.
 *
 * Rows live in a `shallowRef` because that is what the docs tell people to do with list data —
 * `createStore` would proxy every row and cost about 60x per render. Reordering is exposed as a
 * method so a test can drive it after hydration and check that adopted nodes *move* rather than
 * being rebuilt, which is the whole claim of a keyed renderer over server markup.
 */
import { init, render, html, shallowRef, untrack } from '@verajs/core';
import { keyed } from '@verajs/renderer';

export default class SinkList extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const rows = shallowRef([
      { id: 'a', label: 'alpha' },
      { id: 'b', label: 'beta' },
      { id: 'c', label: 'gamma' },
    ]);
    this.rows = rows;

    /** Reverse without subscribing to the read — the write is what re-renders. */
    this.reverse = () => {
      rows.value = [...untrack(() => rows.value)].reverse();
    };
    this.removeFirst = () => {
      rows.value = untrack(() => rows.value).slice(1);
    };
    this.reset = () => {
      rows.value = [
        { id: 'a', label: 'alpha' },
        { id: 'b', label: 'beta' },
        { id: 'c', label: 'gamma' },
      ];
    };

    render(
      () => html`<section id="list">
        <h2>Keyed lists</h2>
        <p class="hint">Reverse, then watch the keyed list: the same nodes move, the unkeyed one is rebuilt.</p>
        <button id="doReverse" @click=${() => this.reverse()}>reverse</button>
        <button id="doRemove" @click=${() => this.removeFirst()}>remove the first</button>
        <button id="doReset" @click=${() => this.reset()}>reset</button>
        <ul id="keyed">
          ${rows.value.map((row) => keyed(row.id, html`<li data-id=${row.id}>${row.label}</li>`))}
        </ul>
        <ul id="unkeyed">
          ${rows.value.map((row) => html`<li data-id=${row.id}>${row.label}</li>`)}
        </ul>
        <p id="count">${rows.value.length}</p>
        <p id="empty" ?hidden=${rows.value.length > 0}>nothing here</p>
      </section>`
    );
  }
}

customElements.define('sink-list', SinkList);
