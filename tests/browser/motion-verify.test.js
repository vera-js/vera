/**
 * The cascade-override instrument - browser truth, because the cascade IS the subject.
 *
 * Two claims plus the control the probe rules demand: a clean element verifies silently, an
 * author !important that beats the generated 0-2-0 selectors is reported BY NAME, and the
 * reporting path provably works (the second claim is the first's control). jsdom deliberately
 * cannot host this suite: its computed styles never see adopted sheets, which is exactly what
 * verify.ts's environment mute exists for.
 */
import { expect } from '@esm-bundle/chai';
import { wireDirectives, motion, rejections, settled } from '../../packages/directives/dist/development/vera-directives.js';

wireDirectives([motion({ inertia: 0 })]);

const frame = () => new Promise((r) => requestAnimationFrame(r));

it('a clean delivery verifies silently; an outranking author rule is reported by name', async () => {
  const authored = document.createElement('style');
  authored.textContent = '.squashed { animation-name: none !important; }';
  document.head.appendChild(authored);

  const host = document.createElement('div');
  host.innerHTML = `
    <div id="clean" data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' }, scroll: '100%, 0%' }">a</div>
    <div id="hit" class="squashed" data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' }, scroll: '100%, 0%' }">b</div>`;
  document.body.appendChild(host);
  await settled();
  await frame();
  await frame();
  await new Promise((r) => setTimeout(r, 60));

  const overridden = rejections().filter((r) => r.code === 'motion-css-overridden');
  expect(overridden.length, 'exactly the squashed element was reported; the clean one stayed silent')
    .to.equal(1);
  expect(overridden[0].element, 'and it names the right element').to.equal(host.querySelector('#hit'));

  authored.remove();
  host.remove();
});
