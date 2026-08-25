/**
 * Hydration where a component contains another component, and where the root is not `{ mode: 'open' }`.
 *
 * A page is a tree of components, so the interesting adoption is not one element's — it is a parent
 * adopting its own markup while each child independently adopts the markup nested inside it, with
 * upgrade order decided by the parser rather than by anyone's code. And a **closed** root is not
 * reachable through `element.shadowRoot` at all, which is why the framework keeps its own handle:
 * if that handle is wrong, a closed component hydrates into nothing and says so nowhere.
 */
import { expect } from '@esm-bundle/chai';
import { wire, init, render, html, createStore } from '../../packages/core/dist/development/vera.js';
import { render as hydratingRender } from '../../packages/renderer/dist/development/vera-renderer-hydrate.js';

wire({ on: 'render', fn: hydratingRender, priority: 50 });
const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

const define = (tag, options, template) =>
  customElements.define(
    tag,
    class extends HTMLElement {
      connectedCallback() {
        init(this, options);
        const state = createStore({ n: 0 });
        this.state = state;
        render(() => template(state, this));
      }
    }
  );

define('nested-leaf', { mode: 'open' }, (state) => html`<p id="leaf">leaf ${state.n}</p>`);
define('nested-branch', { mode: 'open' }, (state) => html`<section id="branch"><nested-leaf></nested-leaf><b id="count">${state.n}</b></section>`);
define('nested-closed', { mode: 'closed' }, (state) => html`<p id="closed">closed ${state.n}</p>`);

/** What `@verajs/ssr` emits for the tree above, nested declarative shadow roots and all. */
const BRANCH = `<template shadowrootmode="open"><section id="branch"><nested-leaf><template shadowrootmode="open"><p id="leaf">leaf 0</p></template></nested-leaf><b id="count">0</b></section></template>`;

const mount = (markup) => {
  const host = document.createElement('div');
  host.setHTMLUnsafe(markup);
  document.body.appendChild(host);
  return host.firstElementChild;
};

describe('a component tree adopts its own markup', () => {
  it('both levels adopt, and neither is rebuilt', async () => {
    const branch = mount(`<nested-branch>${BRANCH}</nested-branch>`);
    expect(branch.shadowRoot, 'the outer declarative root did not parse').to.exist;
    const outerNode = branch.shadowRoot.querySelector('#branch');
    const leafHost = branch.shadowRoot.querySelector('nested-leaf');
    expect(leafHost.shadowRoot, 'the nested declarative root did not parse').to.exist;
    const innerNode = leafHost.shadowRoot.querySelector('#leaf');

    customElements.upgrade(branch);
    await frame();
    await frame();

    expect(branch.shadowRoot.querySelector('#branch'), 'the parent rebuilt its own markup').to.equal(outerNode);
    expect(
      branch.shadowRoot.querySelector('nested-leaf').shadowRoot.querySelector('#leaf'),
      'the child rebuilt the markup nested inside the parent'
    ).to.equal(innerNode);
  });

  it('both levels stay reactive afterwards', async () => {
    const branch = mount(`<nested-branch>${BRANCH}</nested-branch>`);
    customElements.upgrade(branch);
    await frame();
    await frame();

    const leaf = branch.shadowRoot.querySelector('nested-leaf');
    branch.state.n = 4;
    leaf.state.n = 7;
    await frame();
    expect(branch.shadowRoot.querySelector('#count').textContent).to.equal('4');
    expect(leaf.shadowRoot.querySelector('#leaf').textContent).to.equal('leaf 7');
  });

  it('a closed root hydrates, even though nothing outside can see it', async () => {
    const element = mount(
      `<nested-closed><template shadowrootmode="closed"><p id="closed">closed 0</p></template></nested-closed>`
    );
    /** `element.shadowRoot` is null for a closed root — the framework's own handle is the only way in. */
    expect(element.shadowRoot, 'a closed root must not be reachable from outside').to.equal(null);

    customElements.upgrade(element);
    await frame();
    await frame();

    const root = element._root;
    expect(root, 'the framework lost its handle on the closed root').to.exist;
    expect(root.querySelector('#closed')?.textContent).to.equal('closed 0');

    element.state.n = 3;
    await frame();
    expect(root.querySelector('#closed').textContent, 'a closed component stopped re-rendering').to.equal(
      'closed 3'
    );
  });

  it('many instances of one component each adopt their own markup', async () => {
    const host = document.createElement('div');
    host.setHTMLUnsafe(
      Array.from({ length: 5 }, (_, i) =>
        `<nested-leaf><template shadowrootmode="open"><p id="leaf">leaf ${i}</p></template></nested-leaf>`
      ).join('')
    );
    document.body.appendChild(host);
    const before = [...host.children].map((element) => element.shadowRoot.querySelector('#leaf'));

    for (const element of host.children) customElements.upgrade(element);
    await frame();
    await frame();

    const after = [...host.children].map((element) => element.shadowRoot.querySelector('#leaf'));
    /**
     * Each instance keeps **its own** node. Sharing one template between five instances is exactly
     * where an adopted node could be claimed by the wrong one.
     */
    expect(after, 'an instance adopted another instance’s node').to.deep.equal(before);
  });
});

describe('shadow-root options survive the round trip', () => {
  const OPTIONS = [
    ['delegatesFocus', 'shadowrootdelegatesfocus'],
    ['clonable', 'shadowrootclonable'],
    ['serializable', 'shadowrootserializable'],
  ];

  for (const [option, attribute] of OPTIONS) {
    it(`${option} is read back from the markup that declared it`, async () => {
      const tag = `nested-${option.toLowerCase()}`;
      define(tag, { mode: 'open', [option]: true }, () => html`<p id="body">x</p>`);
      const element = mount(
        `<${tag}><template shadowrootmode="open" ${attribute}=""><p id="body">x</p></template></${tag}>`
      );
      customElements.upgrade(element);
      await frame();

      /**
       * `attachShadow` **reuses** a declarative root and ignores the options it is handed, so what
       * the markup declared is what the page has for the rest of its life. The server has to
       * serialize these or they are lost, and this is the half that proves the browser reads them.
       */
      expect(element.shadowRoot[option], `${option} did not survive`).to.equal(true);
    });
  }
});
