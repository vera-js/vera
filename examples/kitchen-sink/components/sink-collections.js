/**
 * Reactive `Map`, `Set`, `WeakMap` and `WeakSet`, which are in core rather than a module.
 *
 * Rendered through `entries()` rather than a spread, because iteration via `for…of` deliberately
 * does not subscribe — the docs say so, and a component that spreads a Map and expects updates is
 * the mistake this component exists to keep honest.
 */
import { init, render, html, createStore } from '@verajs/core';

const WEAK_KEY = { id: 'weak' };

export default class SinkCollections extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({
      users: new Map([
        ['u1', 'Ada'],
        ['u2', 'Grace'],
      ]),
      tags: new Set(['alpha', 'beta']),
      meta: new WeakMap([[WEAK_KEY, 'weak-value']]),
      seen: new WeakSet([WEAK_KEY]),
    });
    this.state = state;
    this.weakKey = WEAK_KEY;

    render(
      () => html`<section id="collections">
        <ul id="users">
          ${[...state.users.entries()].map(([id, name]) => html`<li data-id=${id}>${name}</li>`)}
        </ul>
        <p id="userCount">${state.users.size}</p>
        <p id="hasAda">${state.users.has('u1') ? 'yes' : 'no'}</p>
        <ul id="tags">
          ${[...state.tags.entries()].map(([tag]) => html`<li>${tag}</li>`)}
        </ul>
        <p id="tagCount">${state.tags.size}</p>
        <p id="weak">${state.meta.get(WEAK_KEY)}</p>
        <p id="weakHas">${state.seen.has(WEAK_KEY) ? 'yes' : 'no'}</p>
      </section>`
    );
  }
}

customElements.define('sink-collections', SinkCollections);
