/**
 * **A component moved with `moveBefore()` keeps its setup** (R1, owed browser row). `moveBefore` moves a connected node
 * without the remove-and-insert the platform otherwise performs; core's keep-alive wrapper already keeps a component
 * through a one-operation move (it is still connected at its disconnect), and this row asks a real engine whether a
 * setup made with R1's `init(host, setup)` runs ONCE and tears down NOTHING across a `moveBefore`. Engines without
 * `moveBefore` take the same row through `insertBefore`, the one-operation move the wrapper was built for.
 */
import { expect } from '@esm-bundle/chai';
import { wire, init, html, createStore, useEffect } from '../../packages/core/dist/development/vera.js';
import { renderer } from '../../packages/renderer/dist/development/vera-renderer.js';

wire([renderer]);
const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
let setups = 0;
let cleanups = 0;
customElements.define('mv-card', class extends HTMLElement {
  connectedCallback() {
    init(this, () => {
      setups++;
      const s = createStore({ n: 1 });
      this.state = s;
      useEffect(() => () => { cleanups++; });
      return () => html`<p>${s.n}</p>`;
    });
  }
});

describe('R1 setup across a move', () => {
  it(`a move (${'moveBefore' in Element.prototype ? 'moveBefore' : 'insertBefore — this engine has no moveBefore'}) runs no second setup and no cleanup, and keeps state`, async () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    document.body.append(a, b);
    const card = document.createElement('mv-card');
    a.append(card);
    await frame();
    expect(setups).to.equal(1);
    const p = card.querySelector('p');
    card.state.n = 2;
    await frame();
    console.log(`[move path] ${'moveBefore' in Element.prototype ? 'moveBefore' : 'insertBefore'}`);
    if ('moveBefore' in Element.prototype) b.moveBefore(card, null);
    else b.insertBefore(card, null);
    await frame();
    expect(card.parentNode === b).to.equal(true);
    expect(setups).to.equal(1);
    expect(cleanups).to.equal(0);
    expect(card.querySelector('p') === p).to.equal(true);
    expect(p.textContent).to.equal('2');
    card.remove();
    await frame();
    expect(cleanups).to.equal(1);
    a.remove();
    b.remove();
  });
});
