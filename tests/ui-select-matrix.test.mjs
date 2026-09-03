/**
 * The combination matrix, permanent: every mode combo (single/multi x shadow/light x
 * plain/searchable/creatable/remote) against the core invariants — start closed, open on click,
 * stamp aria-expanded, pick with mode-shaped value and close semantics, refuse disabled rows,
 * reset, Escape. Born as an audit probe (pass 11); promoted because combination coverage is
 * exactly what single-scenario tests cannot see.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent',
  'KeyboardEvent', 'FormData', 'MutationObserver',
]) {
  globalThis[key] = dom.window[key];
}
const { wire } = await load('core');
const { renderer } = await load('renderer');
const { styles } = await load('styles');
wire([renderer, styles]);
await load('ui');
const frame = () => new Promise((resolve) => dom.window.requestAnimationFrame(resolve));
const OPTIONS = [
  { label: 'Alpha', value: 'a' },
  { label: 'Beta', value: 'b' },
  { label: 'Gamma', value: 'g', disabled: true },
];

for (const multi of [false, true])
  for (const light of [false, true])
    for (const flavor of ['plain', 'searchable', 'creatable', 'remote'])
      test(`matrix: ${multi ? 'multi' : 'single'} / ${light ? 'light' : 'shadow'} / ${flavor}`, async () => {
        const element = dom.window.document.createElement('vera-select');
        if (multi) element.setAttribute('multi', '');
        if (light) element.setAttribute('light', '');
        if (flavor !== 'plain') element.setAttribute(flavor, '');
        dom.window.document.body.append(element);
        element.options = OPTIONS;
        await frame();
        const root = element.shadowRoot ?? element;
        const part = (name) => root.querySelector(`[part="${name}"]`);

        assert.equal(part('menu').getAttribute('data-state'), 'closed', 'starts closed');
        assert.equal(part('search').hidden, flavor === 'plain', 'search visibility matches flavor');
        part('trigger').click();
        await frame();
        assert.equal(part('menu').getAttribute('data-state'), 'open');
        assert.equal(part('trigger').getAttribute('aria-expanded'), 'true');
        root.querySelectorAll('[part="option"]')[1].click();
        await frame();
        assert.deepEqual(element.value, multi ? ['b'] : 'b', 'mode-shaped value');
        assert.equal(part('menu').getAttribute('data-state'), multi ? 'open' : 'closed', 'close semantics');
        if (multi) {
          dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
          await frame();
        }
        assert.equal(element.selectedOptions[0].label, 'Beta');
        element.formResetCallback();
        assert.ok(multi ? element.value.length === 0 : element.value === '', 'reset empties without defaults');
        part('trigger').click();
        await frame();
        root.querySelectorAll('[part="option"]')[2].click();
        await frame();
        assert.ok(multi ? !element.value.includes('g') : element.value !== 'g', 'disabled row refused');
        dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
        await frame();
        assert.equal(part('menu').getAttribute('data-state'), 'closed', 'Escape closes');
        element.remove();
      });
