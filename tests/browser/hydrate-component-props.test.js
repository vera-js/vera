/**
 * Hydration of COMPONENT PROPS, through the real pipeline — the seam every other props test
 * reaches by imitation. `COMPONENT_PROPS_HTML` is real `@verajs/ssr` output (generated and
 * `--check`-pinned by `scripts/build-hydration-fixture.mjs`) for a parent that binds written
 * `.prop`, `!prop`, `props()`/spread, and a mapped list onto its children.
 *
 * The ordering under test cannot be faked: the parsed children upgrade and hydrate BEFORE their
 * parent's parts commit, so every prop arrives LATE — after the child's `init()` drained an empty
 * record — and reaches it through `_$adopt$`, which re-runs the child's render hooks. The
 * contract asserted: hydration CONVERGES on exactly the server's content, and the adopted props
 * are live afterwards.
 */
import { expect } from '@esm-bundle/chai';
import { COMPONENT_PROPS_HTML } from './fixtures/hello-ssr.html.js';
import { wire } from '../../packages/core/dist/development/vera.js';
import { renderInto as hydratingRender } from '../../packages/renderer/dist/development/vera-renderer-hydrate.js';

wire({ on: 'render', fn: hydratingRender, priority: 50 });

const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
/** The rows live inside the parent's (declarative) shadow root, so every query goes through it. */
const page = (host) => host.querySelector('props-page').shadowRoot;
const rowTexts = (host) =>
  [...page(host).querySelectorAll('props-row')].map((row) =>
    row.shadowRoot.querySelector('p').textContent.replace(/\s+/g, ' ').trim()
  );

it('hydration converges on the server’s content, props delivered late through adoption', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  host.setHTMLUnsafe(COMPONENT_PROPS_HTML);

  const serverTexts = rowTexts(host);
  expect(serverTexts.length, 'the fixture carries all four rows').to.equal(4);
  expect(serverTexts[0], 'the server rendered from the delivered values').to.contain('written · 7 · written · true');

  /** The same module the SERVER rendered — importing it defines both tags, and the parsed
   *  elements upgrade, init, and hydrate; the parent then commits its bindings late. */
  await import('../../tests/fixtures/ssr/component-props-ssr.js');
  customElements.upgrade(host);
  await frame();
  await frame();

  expect(rowTexts(host), 'every row converged on exactly the server’s content').to.deep.equal(serverTexts);
  expect(
    page(host).querySelector('props-unloaded').outerHTML,
    'the unregistered tag is still the client’s to handle — untouched'
  ).to.equal('<props-unloaded></props-unloaded>');

  /** Live afterwards: the adopted accessor re-renders on a plain property write. */
  const first = page(host).querySelectorAll('props-row')[0];
  first.value = 9;
  await frame();
  expect(first.shadowRoot.querySelector('p').textContent, 'the adopted prop is reactive after hydration')
    .to.contain('· 9 ·');

  host.remove();
});
