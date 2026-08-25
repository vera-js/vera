import { expect } from '@esm-bundle/chai';
import { init, render, html, createStore, wire, setAutoloader } from '../../packages/core/dist/development/vera.js';
import { render as domRender, handle } from '../../packages/renderer/dist/development/vera-renderer.js';
/** List rendering is a module. These suites drive the renderer directly, so they use the
 *  no-registry door rather than `wire([domRender, lists])`. */
import { lists as __lists } from '../../packages/renderer/dist/development/vera-renderer-lists.js';
handle(__lists.fn);

import { initAutoloader } from '../../packages/autoloader/dist/development/vera-autoloader.js';

/**
 * Core, the renderer and the autoloader in one page, wired the way an app wires them.
 *
 * Every other autoloader suite stubs the renderer or omits it, so the combination that actually
 * ships had never run: a real component renders real markup through the real renderer, the render
 * insert offers the element up, and the autoloader has to find an undefined child inside a shadow
 * root it did not create.
 */

const entry = new URL('./fixtures/autoloader/live/entry.js', import.meta.url).href;
const autoload = initAutoloader(entry, '.');

wire({ on: 'render', fn: domRender, priority: 50 });
setAutoloader(autoload);

const until = (condition, timeout = 4000) =>
  new Promise((resolve) => {
    const deadline = Date.now() + timeout;
    const poll = () => (condition() || Date.now() > deadline ? resolve(condition()) : setTimeout(poll, 10));
    poll();
  });
const settle = () => new Promise((r) => setTimeout(r, 300));

it('a real component renders a lazy child, and the child loads and upgrades', async () => {
  customElements.define(
    'live-host',
    class extends HTMLElement {
      connectedCallback() {
        init(this, { mode: 'open' });
        this.setAttribute('autoloader', '');
        render(() => html`<section><lazy-child></lazy-child></section>`);
      }
    }
  );

  const host = document.createElement('live-host');
  document.body.appendChild(host);

  await until(() => customElements.get('lazy-child'));
  expect(customElements.get('lazy-child'), 'the child was discovered inside a shadow root').to.be.a('function');

  /** And it is a working component, not merely a defined one. */
  const child = host.shadowRoot.querySelector('lazy-child');
  await until(() => child.shadowRoot?.querySelector('button'));
  const button = child.shadowRoot.querySelector('button');
  expect(button.textContent.trim()).to.equal('child 0');
  button.click();
  await until(() => button.textContent.trim() === 'child 1');
  expect(button.textContent.trim(), 'the lazily loaded component is reactive').to.equal('child 1');
  host.remove();
});

it('a lazy child appearing on a later render is found too', async () => {
  const state = createStore({ show: false });
  customElements.define(
    'toggle-host',
    class extends HTMLElement {
      connectedCallback() {
        init(this, { mode: 'open' });
        this.setAttribute('autoloader', '');
        render(() => html`<div>${state.show ? html`<nested-grandchild></nested-grandchild>` : ''}</div>`);
      }
    }
  );

  const host = document.createElement('toggle-host');
  document.body.appendChild(host);
  await settle();
  expect(customElements.get('nested-grandchild'), 'nothing to find yet').to.equal(undefined);

  state.show = true;
  await until(() => customElements.get('nested-grandchild'));
  expect(customElements.get('nested-grandchild'), 'found when the render put it there').to.be.a('function');
  host.remove();
});

/* ── the three attributes are part of discovery ──────────────────────────────────────────────── */
/**
 * A marked root already covers its whole subtree, so marking something *inside* one changes
 * nothing. The case that needs the attribute watched is a **shadow host**: an observer cannot see
 * into a shadow root, so a component that gains `autoloader` after it already has one has to be
 * noticed by its attribute or not at all.
 */
it('marking a shadow host later reaches inside its shadow root', async () => {
  const outer = document.createElement('div');
  outer.setAttribute('autoloader', '');
  document.body.appendChild(outer);
  autoload(outer);

  const inner = document.createElement('div');
  outer.appendChild(inner);
  inner.attachShadow({ mode: 'open' }).innerHTML = '<attr-late></attr-late>';
  await settle();
  expect(customElements.get('attr-late'), 'an observer cannot see into a shadow root')
    .to.equal(undefined);

  inner.setAttribute('autoloader', '');
  await until(() => customElements.get('attr-late'));
  expect(customElements.get('attr-late'), 'the attribute is what reaches it').to.be.a('function');
  outer.remove();
});

it('repointing autoload-dir after a failure tries the new location', async () => {
  const original = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args.join(' '));

  const host = document.createElement('div');
  host.setAttribute('autoloader', '');
  host.innerHTML = '<moved-widget autoload-dir="nowhere"></moved-widget>';
  document.body.appendChild(host);
  autoload(host);
  await until(() => errors.length > 0);
  expect(customElements.get('moved-widget'), 'the first location has nothing').to.equal(undefined);

  host.querySelector('moved-widget').setAttribute('autoload-dir', '.');
  await until(() => customElements.get('moved-widget'));
  console.error = original;
  expect(customElements.get('moved-widget'), 'repointing it is enough').to.be.a('function');
  host.remove();
});

it('lifting autoload-ignore lets an element load', async () => {
  const host = document.createElement('div');
  host.setAttribute('autoloader', '');
  host.innerHTML = '<ignored-then-not autoload-ignore></ignored-then-not>';
  document.body.appendChild(host);
  autoload(host);
  await settle();
  expect(customElements.get('ignored-then-not'), 'opted out').to.equal(undefined);

  host.querySelector('ignored-then-not').removeAttribute('autoload-ignore');
  await until(() => customElements.get('ignored-then-not'));
  expect(customElements.get('ignored-then-not'), 'opting back in is enough').to.be.a('function');
  host.remove();
});

/* ── server-rendered markup ──────────────────────────────────────────────────────────────────── */
/**
 * The shape `@verajs/ssr` emits: declarative shadow DOM, parsed by the browser before any script
 * runs. Nothing renders it, so nothing offers it up — `autoload()` is the whole story, and it has to
 * reach through a shadow root the *parser* created rather than one a component attached.
 *
 * jsdom cannot host this at all: it does not parse `<template shadowrootmode="open">` into a shadow
 * root, so the markup would stay inert and the test would pass without proving anything.
 */
it('finds components inside declarative shadow DOM', async () => {
  const container = document.createElement('div');
  container.setHTMLUnsafe(`
    <ssr-shell autoloader>
      <template shadowrootmode="open">
        <h1>rendered on the server</h1>
        <ssr-child></ssr-child>
      </template>
    </ssr-shell>`);
  document.body.appendChild(container);

  const shell = container.querySelector('ssr-shell');
  expect(shell.shadowRoot, 'the parser built a real shadow root').to.not.equal(null);
  expect(shell.shadowRoot.querySelector('ssr-child'), 'with the component inside it').to.not.equal(null);

  autoload();
  await until(() => customElements.get('ssr-child'));
  expect(customElements.get('ssr-child'), 'autoload() reached through the shadow root')
    .to.be.a('function');
  container.remove();
});
