/**
 * **Presets are a pack, and a pack is replaceable.**
 *
 * The ten this library ships are AN example, not THE list, and the three claims that makes real are
 * the ones here: a third party's pack is asked on the same terms as ours, a preset may carry
 * SETTINGS as well as keyframes, and an explicit key on the element beats a preset's — in either
 * written order, which is the part that was accidentally true before and had to be made deliberate.
 *
 * The ordering claim is the subtle one and it is why this file exists. It used to hold by luck:
 * `applyPreset` skipped a property whose base was set and explicit assignment overwrote, so
 * keyframes came out right whichever order the keys appeared in. Settings had no such guard, so the
 * moment a preset could carry one, `{ inertia: 0.5, preset: 'x' }` and `{ preset: 'x', inertia: 0.5 }`
 * would have disagreed. The expansion runs FIRST now, wherever the key sits.
 *
 * Presets are wired here and NOT in `directives-presets-unwired.test.mjs`, which is the same claim
 * from the other side — a suite cannot assert both, because wiring is per process.
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

const { wireDirectives, motion, presets, vocabularyConnector, settled, rejections } =
  await load('directives');

/**
 * A pack of one, wired BESIDE the shipped table — so this also proves the chain asks every link
 * rather than stopping at ours. It carries a setting, which is the capability the shipped ten
 * deliberately do not exercise.
 */
const housePresets = vocabularyConnector({
  on: 'preset',
  fn: (name) => (name === 'house-in'
    ? { keyframes: { opacity: '0% 0, 100% 1' }, inertia: 0.9 }
    : null),
});

wireDirectives([motion, presets, housePresets]);

/** Measurable geometry: jsdom answers 0 for everything, so nothing would have a range. */
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

test('a third-party pack is asked on the same terms as the shipped one', async () => {
  const host = await mount(`
    <div id="ours" data-vd-motion="fade"></div>
    <div id="theirs" data-vd-motion="house-in"></div>`);

  /** The control: if neither animated, every claim below would pass on a silence. */
  assert.match(host.querySelector('#ours').style.filter, /opacity\(/, 'the shipped pack resolved');
  assert.match(host.querySelector('#theirs').style.filter, /opacity\(/, 'and so did a third party’s');
});

test('a preset carries SETTINGS, not only keyframes', async () => {
  const host = await mount(`
    <div id="plain" data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' } }"></div>
    <div id="house" data-vd-motion="house-in"></div>`);

  /** The pack's `inertia: 0.9` reaches the transition; the control says what it would be without. */
  assert.doesNotMatch(host.querySelector('#plain').style.transition, /0\.9s/, 'control: not the default');
  assert.match(host.querySelector('#house').style.transition, /0\.9s/, 'the preset set it');
});

test('an explicit setting beats the preset — in EITHER written order', async () => {
  const host = await mount(`
    <div id="after" data-vd-motion="{ preset: 'house-in', inertia: 0.25 }"></div>
    <div id="before" data-vd-motion="{ inertia: 0.25, preset: 'house-in' }"></div>`);

  for (const id of ['after', 'before']) {
    assert.match(host.querySelector(`#${id}`).style.transition, /0\.25s/,
      `${id}: explicit wins — the expansion runs first, wherever the key is written`);
  }
});

test('an explicit keyframe replaces the preset’s for that property, and keeps the rest', async () => {
  const host = await mount(
    `<div data-vd-motion="{ preset: 'fade-up', keyframes: { translate-y: '0% 200px, 100% 0px' } }"></div>`);
  const el = host.querySelector('div');

  assert.match(el.style.transform, /translateY\((?!0px)/, 'the explicit travel is in force');
  assert.match(el.style.filter, /opacity\(/, 'and the preset’s other property survived');
});

test('a pack that throws costs its own answer, not the page', async () => {
  const host = await mount(`<div data-vd-motion="explodes"></div>`);
  const reasons = rejections(host.querySelector('div'));

  assert.ok(reasons.length > 0, 'the control: something was refused at all');
  assert.ok(reasons.some((r) => r.code === 'motion-preset-unknown'),
    'an unknown name is still an unknown name, not a crash');
  if (!isProduction) {
    assert.ok(reasons.some((r) => /wired/.test(r.fix ?? '')), 'and the fix points at the packs');
  }
});
