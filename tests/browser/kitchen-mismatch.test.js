/**
 * What happens when the server and the client genuinely disagree.
 *
 * Hydration **repairs** a mismatch rather than clearing wholesale — it adopts and corrects where it
 * can — and either way the repair is silent by design: the page looks perfect and the server's work
 * is quietly redone. That is the right behaviour, since a wrong page is worse than a slow one, but
 * it means the failure mode has to be tested deliberately or nothing distinguishes "adopted" from
 * "rebuilt behind your back".
 *
 * So this asserts both halves: a match keeps the **server's nodes**, and a mismatch leaves nothing
 * behind that the component does not describe — which is the rule that actually matters.
 */
import { expect } from '@esm-bundle/chai';
import { wire, init, render, html, createStore } from '../../packages/core/dist/development/vera.js';
import { render as hydratingRender, handle } from '../../packages/renderer/dist/development/vera-renderer-hydrate.js';
/** List rendering is a module. These suites drive the renderer directly, so they use the
 *  no-registry door rather than `wire([domRender, lists])`. */
import { lists as __lists } from '../../packages/renderer/dist/development/vera-renderer-lists.js';
handle(__lists.fn);


wire({ on: 'render', fn: hydratingRender, priority: 50 });
const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/** The client always renders `client`; the fixture decides what the "server" sent. */
customElements.define(
  'mismatch-probe',
  class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      const state = createStore({ rows: ['a', 'b'] });
      this.state = state;
      render(
        () => html`<section id="root">
          <p id="text">client</p>
          <ul id="rows">
            ${state.rows.map((row) => html`<li data-id=${row}>${row}</li>`)}
          </ul>
        </section>`
      );
    }
  }
);

const mount = async (serverBody) => {
  const host = document.createElement('div');
  host.setHTMLUnsafe(
    `<mismatch-probe><template shadowrootmode="open">${serverBody}</template></mismatch-probe>`
  );
  document.body.appendChild(host);
  const element = host.firstElementChild;
  const before = {
    root: element.shadowRoot.querySelector('#root'),
    text: element.shadowRoot.querySelector('#text'),
  };
  customElements.upgrade(element);
  await frame();
  await frame();
  return { element, before };
};

/** Exactly what the component renders, whitespace included — this is the matching case. */
const MATCHING = `<section id="root">
          <p id="text">client</p>
          <ul id="rows">
            <li data-id="a">a</li><li data-id="b">b</li>
          </ul>
        </section>`;

it('adopts the server nodes when the markup matches', async () => {
  const { element, before } = await mount(MATCHING);
  expect(element.shadowRoot.querySelector('#root'), 'matching markup was rebuilt').to.equal(before.root);
  expect(element.shadowRoot.querySelector('#text'), 'a matching subtree was rebuilt').to.equal(before.text);
});

/**
 * The rule that actually matters on a mismatch is not *how* the DOM is produced but that **nothing
 * the server sent survives that the component does not describe**. A stale attribute or a leftover
 * element is a page that disagrees with its own template forever, and nothing would ever say so.
 *
 * The renderer turns out to adopt and correct where it can rather than clearing wholesale, which is
 * strictly better as long as that rule holds — so the rule is what is asserted.
 */
it('leaves nothing behind that the component does not describe', async () => {
  const { element } = await mount(
    `<section id="root" data-server-only="stale">
          <p id="text" title="stale attribute">SERVER SAID SOMETHING ELSE</p>
          <aside id="ghost">an element the client never renders</aside>
          <ul id="rows"><li data-id="z">z</li></ul>
        </section>`
  );

  const root = element.shadowRoot.querySelector('#root');
  expect(element.shadowRoot.querySelector('#text').textContent, 'the text was not corrected').to.equal(
    'client'
  );
  expect(
    element.shadowRoot.querySelector('#text').getAttribute('title'),
    'an attribute the template does not set survived'
  ).to.equal(null);
  expect(root.getAttribute('data-server-only'), 'a stale host attribute survived').to.equal(null);
  expect(element.shadowRoot.querySelector('#ghost'), 'an element the client never renders survived').to.equal(
    null
  );
  expect([...element.shadowRoot.querySelectorAll('#rows li')].map((li) => li.dataset.id)).to.deep.equal([
    'a',
    'b',
  ]);
});

it('stays interactive after falling back', async () => {
  const { element } = await mount('<section id="root"><p id="text">wrong</p></section>');
  element.state.rows = ['x'];
  await frame();
  expect([...element.shadowRoot.querySelectorAll('#rows li')].map((li) => li.dataset.id)).to.deep.equal(['x']);
});

it('an empty server shadow root is a mismatch, not a crash', async () => {
  const { element } = await mount('');
  expect(element.shadowRoot.querySelector('#text').textContent).to.equal('client');
});
