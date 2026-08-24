import { expect } from '@esm-bundle/chai';
import { setRenderer, init, render, html, insert } from '../../packages/core/dist/development/vera.js';
import { render as domRender } from '../../packages/renderer/dist/development/vera-renderer.js';
import { adoptStyles } from '../../packages/styles/dist/development/vera-styles.js';

/**
 * **Generalized:** every shadow mode `init` accepts must behave the same way — content in the root,
 * styles adopted into it, nothing leaking to the light DOM.
 *
 * Written as a matrix rather than a test for one bug, because the bug was structural: `init` called
 * `attachShadow` and discarded what it returned, and everything downstream read
 * `element.shadowRoot` — which is `null` for a closed root, by definition. So `mode: 'closed'`
 * rendered into the **light DOM**, never adopted its styles, and left an unreachable empty root.
 * Any future mode, or any new consumer that reaches for the root, is covered by adding a row here.
 *
 * Only a browser can answer it: jsdom's `attachShadow` and `adoptedStyleSheets` are emulated.
 */

setRenderer(domRender);
insert('init', adoptStyles, 50);

const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

const MODES = [
  { name: 'open', props: { mode: 'open' }, reachable: true },
  { name: 'closed', props: { mode: 'closed' }, reachable: false },
];

for (const { name, props, reachable } of MODES) {
  const tag = `shadow-${name}-el`;
  let root;

  customElements.define(
    tag,
    class extends HTMLElement {
      static styles = `.marker { color: rgb(1, 2, 3) }`;
      connectedCallback() {
        init(this, props);
        /** The element's own view of its root, which is the only handle a closed mode has. */
        root = this._root ?? this.shadowRoot;
        render(() => html`<p class="marker">content</p>`);
      }
    }
  );

  it(`mode: '${name}' renders into the shadow root, not the light DOM`, async () => {
    const element = document.createElement(tag);
    document.body.appendChild(element);
    await frame();
    await frame();

    expect(element.shadowRoot, `shadowRoot is ${reachable ? 'reachable' : 'null'} for ${name}`)
      .to.equal(reachable ? element.shadowRoot : null);
    expect(root, 'the component can reach its own root').to.not.equal(null);
    expect(root.querySelector('p')?.textContent, 'content is inside the root').to.equal('content');
    expect(element.innerHTML, 'nothing leaked into the light DOM').to.equal('');
    element.remove();
  });

  it(`mode: '${name}' adopts its styles into the shadow root`, async () => {
    const element = document.createElement(tag);
    document.body.appendChild(element);
    await frame();
    await frame();

    const adopted = root.adoptedStyleSheets?.length > 0 || root.querySelector('style[vera-styles]');
    expect(adopted, 'styles reached the root').to.be.ok;
    /** And they apply — the point of adopting them. */
    expect(getComputedStyle(root.querySelector('.marker')).color).to.equal('rgb(1, 2, 3)');
    element.remove();
  });
}

it('light DOM (no shadow props) still renders into the element', async () => {
  customElements.define(
    'shadow-none-el',
    class extends HTMLElement {
      connectedCallback() {
        init(this);
        render(() => html`<p>light</p>`);
      }
    }
  );
  const element = document.createElement('shadow-none-el');
  document.body.appendChild(element);
  await frame();
  await frame();
  expect(element.shadowRoot).to.equal(null);
  expect(element._root, 'no root is created for light DOM').to.equal(undefined);
  expect(element.querySelector('p')?.textContent).to.equal('light');
  element.remove();
});
