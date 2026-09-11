/**
 * data-vd-stream against a REAL EventSource and real server bytes (the runner's /wtr-sse
 * middleware), on every engine. String assertions only — the motion-verify scar.
 */
import { expect } from '@esm-bundle/chai';
import { wireDirectives, interactions, expressions, remote, settled }
  from '../../packages/directives/dist/development/vera-directives.js';

wireDirectives([expressions, ...interactions, remote]);

const until = async (probe, what, tries = 100) => {
  for (let i = 0; i < tries; i++) {
    if (probe()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out: ${what}`);
};

it('a real SSE push patches state and delivers live markup on a shared wire', async () => {
  const host = document.createElement('div');
  host.innerHTML = `
    <div data-vd-state="{ streamed: 0, link: '' }">
      <b data-vd-text="streamed"></b>
      <div data-vd-stream="{ url: '/wtr-sse', status: 'link' }"></div>
      <div id="sse-zone" data-vd-stream="{ url: '/wtr-sse', event: 'story', into: '#sse-zone' }"></div>
    </div>`;
  document.body.appendChild(host);
  await settled();
  await until(() => host.querySelector('b').textContent === '21', 'the JSON patch landed');
  expect(host.querySelector('b').textContent).to.equal('21');
  await until(() => host.querySelector('#sse-pushed'), 'the named markup event landed');
  expect(host.querySelector('#sse-pushed').textContent).to.equal('pushed');
  host.remove();
  await settled();
});
