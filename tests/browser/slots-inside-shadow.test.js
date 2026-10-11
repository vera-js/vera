/**
 * **A light-DOM component inside a SHADOW component's shadow root** — Brian's question when slots
 * moved to one page-wide observer: does it still see changes there?
 *
 * It does by construction, and this is what makes the claim a measurement rather than an argument.
 * The observer is one INSTANCE that observes each light host directly; `observe()` works on a node
 * inside a shadow root like any other, and a `subtree` watch from the document would not cross the
 * boundary, which is exactly why nothing watches from the document. A record is routed to the
 * nearest host by walking up from its target, and that host is found inside the shadow tree before
 * the walk ever reaches the root.
 *
 * Every path is exercised from inside the shadow tree: content the SHADOW component's render places
 * into the light one (authored by the shadow root, so the light host's slottables), a later addition
 * by the user, a re-slot, and a re-render of the outer component updating what it placed.
 */
import { expect } from '@esm-bundle/chai';
import { renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import { slots } from '../../packages/renderer/dist/development/vera-renderer-slots.js';
import { html, wire, init, createStore } from '../../packages/core/dist/development/vera.js';

wire([renderer, slots]);
const settle = async () => {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

customElements.define('lis-card', class extends HTMLElement {
  connectedCallback() {
    init(this, () => {
      return () => html`<article><header><slot name="h">no title</slot></header><main><slot>no body</slot></main></article>`;
    });
  }
});

const state = createStore({ title: 'One' });
customElements.define('lis-shell', class extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<section><lis-card><h2 slot="h">${state.title}</h2>placed body</lis-card></section>`;
    });
  }
});

it('a light component in a shadow root distributes, stays live, and follows the outer render', async () => {
  const shell = document.createElement('lis-shell');
  document.body.append(shell);
  await settle();
  const card = shell.shadowRoot.querySelector('lis-card');
  const read = () => ({
    header: card.querySelector('header').textContent.trim(),
    main: card.querySelector('main').textContent.trim(),
  });
  expect(read(), 'placed content reached its slots').to.deep.equal({ header: 'One', main: 'placed body' });

  const late = document.createElement('b');
  late.textContent = 'late';
  card.append(late);
  await settle();
  expect(read().main, 'a later user addition inside the shadow tree was seen').to.equal('placed bodylate');

  late.setAttribute('slot', 'h');
  await settle();
  expect(read(), 'and a re-slot re-routed it').to.deep.equal({ header: 'Onelate', main: 'placed body' });

  state.title = 'Two';
  await settle();
  expect(read().header, 'the outer render updated what it placed, in place').to.equal('Twolate');
  expect(card.querySelectorAll('h2').length, 'without duplicating it').to.equal(1);
  shell.remove();
});
