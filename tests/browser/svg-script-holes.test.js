import { expect } from '@esm-bundle/chai';
import * as coreDev from '../../packages/core/dist/development/vera.js';
import { renderer as rendererDev, renderInto as renderIntoDev } from '../../packages/renderer/dist/development/vera-renderer.js';
import * as coreMin from '../../packages/core/dist/vera.min.js';
import { renderer as rendererMin, renderInto as renderIntoMin } from '../../packages/renderer/dist/vera-renderer.min.js';
import * as lite from '../../packages/lite/dist/vera-lite.min.js';
import * as staticTier from '../../packages/static/dist/vera-static.min.js';

coreDev.wire([rendererDev]);
coreMin.wire([rendererMin]);

/**
 * **A value in an SVG `<script>` never runs, in any renderer, in any build** (2026-11-18). An SVG script from a template
 * runs in Chromium and WebKit (BROWSER-LEDGER), so a hole in one is refused in production too, not only in development.
 * The positive control: a script created with `createElement`, holding the same counter, runs — or this proves nothing.
 */
/**
 * Each renderer's attempt to draw the SVG-script hole, the refusal reaching THIS caller (a refusal thrown inside a custom
 * element's reaction is reported to the page, where the test runner takes it for a failure): core through `renderInto`;
 * lite and static by a harmless first render, then `connectedCallback` called directly.
 */
const svgHole = (html) => html`<svg><script>${'window.svgHole++'}</script></svg>`;
const viaRenderInto = (core, renderInto) => (host) => renderInto(svgHole(core.html), host);
const viaConnect = (tier) => (host) => {
  let bad = false;
  const tag = `svgh-${seq++}`;
  tier.define(tag, () => () => (bad ? svgHole(tier.html) : tier.html`<svg><g></g></svg>`));
  const element = host.appendChild(document.createElement(tag));
  bad = true;
  element.connectedCallback();
};
const TIERS = {
  'core dev': viaRenderInto(coreDev, renderIntoDev),
  'core min': viaRenderInto(coreMin, renderIntoMin),
  'lite min': viaConnect(lite),
  /** Static renders once, on a direct connect even when detached: drawn with the hole straight away, then moved in. */
  'static min': (host) => {
    const Class = staticTier.define(`svgh-${seq++}`, () => () => svgHole(staticTier.html));
    const element = new Class();
    element.connectedCallback();
    host.append(element);
  },
};
let seq = 0;

it('CONTROL: a created script runs here, so a silence below is a refusal, not a page that runs nothing', () => {
  window.svgHole = 0;
  const script = document.createElement('script');
  script.textContent = 'window.svgHole++';
  document.body.append(script);
  expect(window.svgHole).to.equal(1);
  script.remove();
});

for (const [name, attempt] of Object.entries(TIERS))
  it(`${name}: a value in an SVG <script> is refused, and never runs`, async () => {
    window.svgHole = 0;
    const host = document.body.appendChild(document.createElement('div'));
    let refused = false;
    try {
      attempt(host);
    } catch {
      refused = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(refused, `${name}: refused`).to.equal(true);
    expect(window.svgHole, `${name}: the SVG script ran`).to.equal(0);
    host.remove();
  });
