/**
 * Keyed lists, and the reordering that only a keyed renderer survives.
 *
 * Rows live in a `shallowRef` because that is what the docs tell people to do with list data —
 * `createStore` would proxy every row and cost about 60x per render. Reordering is exposed as a
 * method so a test can drive it after hydration and check that adopted nodes *move* rather than
 * being rebuilt, which is the whole claim of a keyed renderer over server markup.
 */
import { init, render, html, shallowRef, untrack } from '@verajs/core';
import { keyed } from '@verajs/renderer/keyed';

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
        <h2>Lists</h2>
        <h3>A keyed list moves the nodes it already has; the unkeyed one below is rebuilt from scratch</h3>
        <h4>Press reverse and watch both lists, then remove the first a few times to reach the empty state.</h4>
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
