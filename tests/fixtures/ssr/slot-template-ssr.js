/**
 * A light-slot component whose own markup contains a `<template>`. `@verajs/ssr`'s DOM declines to
 * parse markup it cannot reproduce exactly — a `<template>` holds a fragment rather than children —
 * so the host has no nodes for a query to find and the server cannot distribute. The client can.
 * The point of this fixture is that the divergence is announced rather than silent.
 */
import { init, render, html } from '@verajs/core';

export class SlotTemplateSsr extends HTMLElement {
  connectedCallback() {
    init(this);
    render(() => html`<p><slot name="h">fallback</slot><template><i>inert</i></template></p>`);
  }
}

customElements.define('slot-template-ssr', SlotTemplateSsr);
