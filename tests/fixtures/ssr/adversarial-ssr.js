import { init, render, html } from '@verajs/core';
customElements.define('mark-comp', class extends HTMLElement {
  connectedCallback() { init(this, { mode: 'open' }); render(() => html`<b>MARK</b>`); }
});
/**
 * Every place a component tag can hide from a scanner that reads markup as text.
 *
 * `<iframe>` and `<noscript>` joined the raw-text list once all three engines were measured: a
 * parser reads their children as text, so a component named inside one is never upgraded on the
 * client and must not be rendered on the server either. The nested `<template>` exercises the
 * depth-aware skip rather than the search-for-a-closing-tag one the raw-text elements use — they
 * cannot nest and templates can, which is why the two are handled differently.
 */
export default class AdversarialSsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`
      <div id="a" title="a > b"><mark-comp></mark-comp></div>
      <mark-comp title="x > y"></mark-comp>
      <!-- <mark-comp></mark-comp> -->
      <textarea><mark-comp></mark-comp></textarea>
      <iframe><mark-comp></mark-comp></iframe>
      <noscript><mark-comp></mark-comp></noscript>
      <template><template><mark-comp></mark-comp></template></template>
      <div data-x=mark-comp></div><mark-comp id="unquoted"></mark-comp>
      <p>done</p>`);
  }
}
customElements.define('adversarial-ssr', AdversarialSsr);
