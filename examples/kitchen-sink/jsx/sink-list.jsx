/**
 * The JSX twin of `../components/sink-list.js` — keyed lists through `key={}`, which the transform
 * compiles to `keyed()` from `@verajs/renderer`.
 */
import { init, render, shallowRef, untrack } from '@verajs/core';

export default class SinkList extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const rows = shallowRef([
      { id: 'a', label: 'alpha' },
      { id: 'b', label: 'beta' },
      { id: 'c', label: 'gamma' },
    ]);
    this.rows = rows;
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

    render(() => (
      <section id="list">
        <h2>Lists</h2>
        <h3>A keyed list moves the nodes it already has; the unkeyed one below is rebuilt from scratch</h3>
        <h4>Press reverse and watch both lists, then remove the first a few times to reach the empty state.</h4>
        <button id="doReverse" onClick={() => this.reverse()}>reverse</button>
        <button id="doRemove" onClick={() => this.removeFirst()}>remove the first</button>
        <button id="doReset" onClick={() => this.reset()}>reset</button>
        <ul id="keyed">
          {rows.value.map((row) => (
            <li key={row.id} data-id={row.id}>{row.label}</li>
          ))}
        </ul>
        <ul id="unkeyed">
          {rows.value.map((row) => (
            <li data-id={row.id}>{row.label}</li>
          ))}
        </ul>
        <p id="count">{rows.value.length}</p>
        <p id="empty" hidden={rows.value.length > 0}>nothing here</p>
      </section>
    ));
  }
}

customElements.define('sink-list', SinkList);
