import { expect } from '@esm-bundle/chai';
import { init, html, createStore, wire } from '../../packages/core/dist/development/vera.js';
import { renderInto as renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import { autoloader } from '../../packages/autoloader/dist/development/vera-autoloader.js';
import { until } from './until.js';

/**
 * Core, the renderer and the autoloader in one page, wired the way an app wires them.
 *
 * Every other autoloader suite stubs the renderer or omits it, so the combination that actually
 * ships had never run: a real component renders real markup through the real renderer, the render
 * insert offers the element up, and the autoloader has to find an undefined child inside a shadow
 * root it did not create.
 */

const entry = new URL('./fixtures/autoloader/live/entry.js', import.meta.url).href;
/**
 * **What the autoloader asked for**, read through its own `resolve` option (the default's URLs): a row that says nothing
 * loaded YET reads `asked` once the work that would have asked is done, instead of sleeping 300 ms and reading
 * `customElements.get`, which proved nothing about a load a busy machine delivers late. The ask is synchronous in the
 * scan; a scan follows a render or a mutation-observer delivery, both done by the next task.
 */
const asked = [];
const autoload = autoloader(entry, '.', { resolve: (tag, dir) => (asked.push(tag), `${dir}/${tag}.js`) });

/** A macrotask: every mutation-observer delivery and microtask queued before it has run. Not a time. */
const task = () => new Promise((r) => setTimeout(r, 0));

wire({ on: 'render', fn: renderer, priority: 50 });
wire(autoload);


it('a real component renders a lazy child, and the child loads and upgrades', async () => {
  customElements.define(
    'live-host',
    class extends HTMLElement {
      connectedCallback() {
        init({ host: this, shadow: 'open' }, () => {
          this.setAttribute('data-autoload', '');
          return () => html`<section><lazy-child></lazy-child></section>`;
        });
      }
    }
  );

  const host = document.createElement('live-host');
  document.body.appendChild(host);

  await until(() => customElements.get('lazy-child'), "() => customElements.get('lazy-child')", 4000);
  expect(customElements.get('lazy-child'), 'the child was discovered inside a shadow root').to.be.a('function');

  /** And it is a working component, not merely a defined one. */
  const child = host.shadowRoot.querySelector('lazy-child');
  await until(() => child.shadowRoot?.querySelector('button'), "() => child.shadowRoot?.querySelector('button')", 4000);
  const button = child.shadowRoot.querySelector('button');
  expect(button.textContent.trim()).to.equal('child 0');
  button.click();
  await until(() => button.textContent.trim() === 'child 1', "() => button.textContent.trim() === 'child 1'", 4000);
  expect(button.textContent.trim(), 'the lazily loaded component is reactive').to.equal('child 1');
  host.remove();
});

it('a lazy child appearing on a later render is found too', async () => {
  const state = createStore({ show: false });
  customElements.define(
    'toggle-host',
    class extends HTMLElement {
      connectedCallback() {
        init({ host: this, shadow: 'open' }, () => {
          this.setAttribute('data-autoload', '');
          return () => html`<div>${state.show ? html`<nested-grandchild></nested-grandchild>` : ''}</div>`;
        });
      }
    }
  );

  const host = document.createElement('toggle-host');
  document.body.appendChild(host);
  await until(() => host.shadowRoot?.querySelector('div'), 'the first render', 4000);
  await task();
  expect(asked.includes('nested-grandchild'), 'nothing to find yet').to.equal(false);

  state.show = true;
  await until(() => customElements.get('nested-grandchild'), "() => customElements.get('nested-grandchild')", 4000);
  expect(customElements.get('nested-grandchild'), 'found when the render put it there').to.be.a('function');
  host.remove();
});

/* ── the three attributes are part of discovery ──────────────────────────────────────────────── */
/**
 * A marked root already covers its whole subtree, so marking something *inside* one changes
 * nothing. The case that needs the attribute watched is a **shadow host**: an observer cannot see
 * into a shadow root, so a component that gains `data-autoload` after it already has one has to be
 * noticed by its attribute or not at all.
 */
it('marking a shadow host later reaches inside its shadow root', async () => {
  const outer = document.createElement('div');
  outer.setAttribute('data-autoload', '');
  document.body.appendChild(outer);
  autoload(outer);

  const inner = document.createElement('div');
  outer.appendChild(inner);
  inner.attachShadow({ mode: 'open' }).innerHTML = '<attr-late></attr-late>';
  /** CONTROL: a tag in outer's light DOM, added after the shadow root was filled, is asked for in the same delivery. */
  outer.append(document.createElement('ctl-outer'));
  await task();
  expect(asked.includes('ctl-outer'), 'CONTROL: the observer delivered').to.equal(true);
  expect(asked.includes('attr-late'), 'an observer cannot see into a shadow root').to.equal(false);

  inner.setAttribute('data-autoload', '');
  await until(() => customElements.get('attr-late'), "() => customElements.get('attr-late')", 4000);
  expect(customElements.get('attr-late'), 'the attribute is what reaches it').to.be.a('function');
  outer.remove();
});

it('repointing data-autoload-dir after a failure tries the new location', async () => {
  const original = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args.join(' '));

  const host = document.createElement('div');
  host.setAttribute('data-autoload', '');
  host.innerHTML = '<moved-widget data-autoload-dir="nowhere"></moved-widget>';
  document.body.appendChild(host);
  autoload(host);
  await until(() => errors.length > 0, "() => errors.length > 0", 4000);
  expect(customElements.get('moved-widget'), 'the first location has nothing').to.equal(undefined);

  host.querySelector('moved-widget').setAttribute('data-autoload-dir', '.');
  await until(() => customElements.get('moved-widget'), "() => customElements.get('moved-widget')", 4000);
  console.error = original;
  expect(customElements.get('moved-widget'), 'repointing it is enough').to.be.a('function');
  host.remove();
});

it('lifting data-autoload-ignore lets an element load', async () => {
  const host = document.createElement('div');
  host.setAttribute('data-autoload', '');
  host.innerHTML = '<ignored-then-not data-autoload-ignore></ignored-then-not><ctl-ignored></ctl-ignored>';
  document.body.appendChild(host);
  autoload(host);
  expect(asked.includes('ctl-ignored'), 'CONTROL: the same scan asked for its sibling').to.equal(true);
  expect(asked.includes('ignored-then-not'), 'opted out').to.equal(false);

  host.querySelector('ignored-then-not').removeAttribute('data-autoload-ignore');
  await until(() => customElements.get('ignored-then-not'), "() => customElements.get('ignored-then-not')", 4000);
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
    <ssr-shell data-autoload>
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
  await until(() => customElements.get('ssr-child'), "() => customElements.get('ssr-child')", 4000);
  expect(customElements.get('ssr-child'), 'autoload() reached through the shadow root')
    .to.be.a('function');
  container.remove();
});
