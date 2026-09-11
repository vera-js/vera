/**
 * The when-fold's two browser claims — the ones only a real cascade can prove.
 *
 * 1. THE POSTER CHILD: a server-rendered page's gate BEHAVES with no motion JavaScript wired at
 *    all — renderMotion emits, the class toggles, the transition runs. The first emission that
 *    behaves rather than merely showing an end state.
 * 2. THE SPECIFICITY ROW (omni's corpus ask): :where() neutralises a wild author selector —
 *    #id.class[attr] inside the gate still lands 0-2-0, proven by an ordinary 0-3-0 author rule
 *    BEATING the folded active rule (if the selector leaked, 1-1-1 inside would win instead).
 */
import { expect } from '@esm-bundle/chai';
import { renderMotion } from '../../packages/motion/dist/development/vera-motion-ssr.js';

const frame = () => new Promise((r) => requestAnimationFrame(r));

it('a folded gate behaves with NO wiring: server CSS + a class toggle = the transition', async () => {
  const host = document.createElement('div');
  host.innerHTML = `<div id="fold" data-vd-motion="{ keyframes: { opacity: '0% 0.2, 100% 0.9' }, when: '.lit', play: 0.25 }">x</div>`;
  document.body.appendChild(host);
  const report = renderMotion(document, {});
  expect(report.rendered, 'the CONTROL: the server rendered it').to.equal(1);
  /** NOTHING is wired. The page has emitted CSS and markup, and that must be enough. */
  const el = host.querySelector('#fold');
  await frame();
  expect(getComputedStyle(el).filter, 'base paints from server CSS alone').to.match(/opacity\(0\.2\)/);

  el.classList.add('lit');
  await new Promise((r) => setTimeout(r, 400));
  expect(getComputedStyle(el).filter, 'the class alone drove the transition — zero JS involved')
    .to.match(/opacity\(0\.9\)/);

  el.classList.remove('lit');
  await new Promise((r) => setTimeout(r, 400));
  expect(getComputedStyle(el).filter, 'and reverses the same way').to.match(/opacity\(0\.2\)/);
  host.remove();
});

it(':where() keeps a wild gate at 0-2-0 — an ordinary three-class author rule outranks it', async () => {
  const authored = document.createElement('style');
  authored.textContent = '.a.b.c { filter: opacity(0.33); }';
  document.head.appendChild(authored);
  const host = document.createElement('div');
  host.innerHTML = `<div id="wild" class="a b c" data-vd-motion="{ keyframes: { opacity: '0% 0.1, 100% 1' }, when: '#wild.a[data-k]', play: 0.1 }">x</div>`;
  document.body.appendChild(host);
  renderMotion(document, {});
  const el = host.querySelector('#wild');
  el.setAttribute('data-k', '');
  await new Promise((r) => setTimeout(r, 250));
  /** Gate matches (#wild.a[data-k]) — if its specificity leaked through :where(), the active
   *  rule would be 1-2-1 + 0-2-0 and beat the author's 0-3-0. It must not. */
  expect(getComputedStyle(el).filter, 'the author rule wins — the gate carried ZERO specificity')
    .to.match(/opacity\(0\.33\)/);
  authored.remove();
  host.remove();
});
