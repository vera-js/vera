/**
 * Reactive `Map`, `Set`, `WeakMap` and `WeakSet`, which live in `@verajs/reactivity/collections` — wired
 * once in `wiring.js`. Without it core raises a `__DEV__` error and the first method call throws.
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

    /** Named so a reader can drive them from the page and a test can drive them directly. */
    let added = 0;
    this.addUser = () => state.users.set(`u${state.users.size + 1}-${added}`, `Person ${++added}`);
    this.addTag = () => state.tags.add(`tag-${state.tags.size + 1}`);
    this.setWeak = () => state.meta.set(WEAK_KEY, `changed ${++added}`);
    this.clearAll = () => {
      state.users.clear();
      state.tags.clear();
    };

    render(
      () => html`<section id="collections">
        <h2>Collections</h2>
        <h3>Map, Set, WeakMap and WeakSet are reactive per key, with no module to install and nothing to wire</h3>
        <h4>Add a user or a tag and only that list re-renders. Clear both to notify every subscriber at once.</h4>
        <button id="addUser" @click=${() => this.addUser()}>add a user</button>
        <button id="addTag" @click=${() => this.addTag()}>add a tag</button>
        <button id="setWeak" @click=${() => this.setWeak()}>change the WeakMap value</button>
        <button id="clearAll" @click=${() => this.clearAll()}>clear both</button>
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
