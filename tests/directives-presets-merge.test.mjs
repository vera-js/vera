/**
 * **`presets(table)` merges over the shipped ten rather than replacing them.**
 *
 * Its own process because it must wire `presets(table)` and NOT the bare `presets` — which is the
 * designed usage, and the thing the second test here explains. The insert chain answers from the
 * FIRST registered resolver, so wiring both would let the shipped table answer `fade-up` and every
 * override in the custom table would silently do nothing. That is refused rather than tolerated.
 *
 * Merge was chosen over replace for two reasons. Overriding one preset is the common intent, and
 * replace-by-default would silently lose the other nine. And chaining two packs instead would have
 * put an ordering rule at the wiring level — `[motion, presets, presets(house)]` resolving a
 * collision differently from its reverse, with nothing on the page saying which won — which is the
 * same invisible order-dependence the expansion pass exists to remove one level down.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MouseEvent', 'MutationObserver',
  'CSSStyleSheet', 'getComputedStyle', 'IntersectionObserver', 'ResizeObserver']) {
  if (dom.window[k]) globalThis[k] = dom.window[k];
}
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { wireDirectives, motion, presets, settled, rejections } = await load('directives');

/** `fade-up` redefined to fade OUT and travel nowhere, so "whose fade-up ran" is visible in the DOM. */
wireDirectives([motion, presets({ 'fade-up': { keyframes: { opacity: '0% 1, 100% 0' } } })]);

const mount = async (markup) => {
  const host = dom.window.document.createElement('div');
  host.innerHTML = markup;
  for (const el of host.children) {
    Object.defineProperty(el, 'offsetTop', { value: 300, configurable: true });
    Object.defineProperty(el, 'offsetHeight', { value: 200, configurable: true });
  }
  dom.window.document.body.appendChild(host);
  await settled();
  await new Promise((r) => setTimeout(r, 30));
  return host;
};

test('a redefined name is THEIRS, and the nine untouched ones are still ours', async () => {
  const host = await mount(`
    <div id="over" data-vd-motion="fade-up"></div>
    <div id="kept" data-vd-motion="blur-in"></div>`);

  const over = host.querySelector('#over');
  assert.match(over.style.filter, /opacity\(/, 'the control: the overridden name resolved at all');
  assert.equal(over.style.transform, '',
    'and it is theirs — the shipped fade-up carries translate-y and would have written a transform');

  /** The claim that separates merge from replace. */
  assert.match(host.querySelector('#kept').style.filter, /blur\(/,
    'a name the custom table never mentions still resolves, from the shipped ten');
});

test('wiring presets twice is refused, because the second one could not have won', async () => {
  const before = rejections().length;
  wireDirectives([presets]);
  const added = rejections().slice(before);

  assert.ok(added.some((r) => r.code === 'motion-presets-wired-twice'),
    'the chain answers from the first resolver, so a second registration silently overrides nothing');
  if (!isProduction) {
    assert.ok(added.some((r) => /alone/.test(r.fix ?? '')),
      'and the fix says which of the two calls to keep');
  }
});
