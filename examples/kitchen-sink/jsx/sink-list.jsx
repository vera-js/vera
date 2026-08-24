/**
 * The JSX twin of `../components/sink-list.js` — keyed lists through `key={}`, which the transform
 * compiles to `keyed()` from `@verajs/renderer`.
 */
import { init, render, html, shallowRef, untrack } from '@verajs/core';

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

    render(() => (
      <section id="list">
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
    void html;
  }
}

customElements.define('sink-list', SinkList);
