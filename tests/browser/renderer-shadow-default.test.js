/**
 * **`renderer({ shadow: 'open' })` on both sides: the client adopts what the server served** (R1 piece 3, owed
 * browser row). The node half — tests/renderer-shadow-default's server row — pins that the REAL server emits exactly
 * `SERVED` for this component through the same shared `wire([renderer({ shadow: 'open' })])`; this half lets a real
 * engine parse it as a declarative shadow root and checks the client adopts it: the same node, no fallback, and live.
 * A served root is adopted whatever the client's default says (core renders into an existing root), so the second row
 * is the client half of the default itself: a component the server never rendered gets its open root from it.
 */
import { expect } from '@esm-bundle/chai';
import { wire, init, html, createStore } from '../../packages/core/dist/development/vera.js';
import { renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import { hydration } from '../../packages/renderer/dist/development/vera-renderer-hydration.js';

wire([renderer({ shadow: 'open' }), hydration]);
const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

const SERVED = '<sd-card><template shadowrootmode="open"><p>served</p></template></sd-card>';
let state;
customElements.define('sd-card', class extends HTMLElement {
  connectedCallback() {
    init(this, () => {
      state = createStore({ text: 'served' });
      return () => html`<p>${state.text}</p>`;
    });
  }
});

describe('renderer({ shadow }) — the default root, server and client', () => {
  it('a declarative open root the server rendered is adopted by identity, with no fallback, and stays live', async () => {
    const said = [];
    const warn = console.warn;
    console.warn = (...a) => said.push(a.join(' '));
    const host = document.createElement('div');
    try {
      host.setHTMLUnsafe(SERVED);
      const card = host.firstElementChild;
      expect(card.shadowRoot !== null).to.equal(true);
      const servedP = card.shadowRoot.querySelector('p');
      expect(servedP !== null).to.equal(true);
      document.body.appendChild(host);
      await frame();
      expect(card.shadowRoot.mode).to.equal('open');
      expect(card.shadowRoot.querySelector('p') === servedP).to.equal(true);
      state.text = 'live';
      await frame();
      expect(servedP.textContent).to.equal('live');
      expect(card.shadowRoot.querySelector('p') === servedP).to.equal(true);
    } finally {
      console.warn = warn;
      host.remove();
    }
    expect(said.filter((line) => line.includes('hydration-fallback'))).to.deep.equal([]);
  });

  it('a component the server never rendered gets its open root from the default, in a real engine', async () => {
    const card = document.createElement('sd-card');
    document.body.appendChild(card);
    await frame();
    expect(card.shadowRoot !== null && card.shadowRoot.mode === 'open').to.equal(true);
    expect(card.shadowRoot.querySelector('p')?.textContent).to.equal('served');
    card.remove();
  });
});
