/**
 * Builds a registered child element and leaves it somewhere the scan will not render — inside a
 * `<template>`, whose contents this serializer deliberately does not walk. The instance is therefore
 * *marked* and never emitted, which is exactly the state `pendingInstances.clear()` exists to stop
 * one request handing to the next. Built for `tests/ssr-concurrency-stress.test.mjs`.
 */
import { init, render, html } from '@verajs/core';

class PendingChild extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<i>child</i>`);
  }
}
customElements.define('pending-child-ssr', PendingChild);

export default class PendingInstanceSsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<p>host</p>`);
    const holder = document.createElement('template');
    holder.appendChild(document.createElement('pending-child-ssr'));
    this.shadowRoot.appendChild(holder);
  }
}
customElements.define('pending-instance-ssr', PendingInstanceSsr);
