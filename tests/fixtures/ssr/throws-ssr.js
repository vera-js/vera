/**
 * A component that throws while rendering, server-side. The fixture for the contract
 * `renderToString` documents: it collects failures, finishes the walk, and throws once at the end
 * naming every component that failed — so a caller can fall back to a client-rendered shell rather
 * than ship the empty markup the failure would otherwise produce.
 */
import { init, render } from '@verajs/core';

export default class ThrowsSsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => {
      throw new Error('component exploded');
    });
  }
}

customElements.define('throws-ssr', ThrowsSsr);
