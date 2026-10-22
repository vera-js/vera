/**
 * **Hydrating a `define` component whose observed ATTRIBUTES drive its render** (R3, 2026-10-21). `DEFINE_ATTRS_HTML`
 * is real `@verajs/ssr` output (generated and `--check`-pinned by `scripts/build-hydration-fixture.mjs`): the server
 * delivered `label`, `data-count` and `tone` (the last shared with a declared prop) before connect, so the markup carries
 * their values. The client parses that markup, defines the tag, the element UPGRADES with the attributes present — the
 * platform delivers them before `connectedCallback` — and must converge on exactly the server's content with ONE render,
 * then stay live.
 */
import { expect } from '@esm-bundle/chai';
import { DEFINE_ATTRS_HTML } from './fixtures/hello-ssr.html.js';
import { wire } from '../../packages/core/dist/development/vera.js';
import { renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import { hydration } from '../../packages/renderer/dist/development/vera-renderer-hydration.js';

wire([renderer, hydration]);

const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const text = (host) => host.querySelector('attrs-card').shadowRoot.querySelector('p').textContent.replace(/\s+/g, ' ').trim();

it('a define component hydrates its server-rendered attribute values with ONE render, and stays live', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  host.setHTMLUnsafe(DEFINE_ATTRS_HTML);
  const server = text(host);
  expect(server, 'the server rendered from the markup attributes (shared prop included)').to.equal('Hello · 3 · loud');

  globalThis.__defineAttrsRenders = { n: 0 };
  await import('../../tests/fixtures/ssr/define-attrs-ssr.js');
  customElements.upgrade(host);
  await frame();
  await frame();

  expect(text(host), 'hydration converged on exactly the server’s content').to.equal(server);
  expect(globalThis.__defineAttrsRenders.n === 1, `the client rendered ONCE, nothing to correct (rendered ${globalThis.__defineAttrsRenders.n})`).to.equal(true);

  const card = host.querySelector('attrs-card');
  card.setAttribute('label', 'Changed');
  await frame();
  expect(text(host), 'an attribute written after hydration repaints').to.equal('Changed · 3 · loud');
  host.remove();
});
