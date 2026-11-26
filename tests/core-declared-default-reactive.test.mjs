/**
 * **A first read of a declared prop subscribes, even when it only finds the default** (2026-11-26). An effect or a
 * render that reads a declared attribute or prop before the element has written anything must re-run when that value
 * changes later, by attribute or by property. A read that answers the default without building the element's props
 * store also subscribes to nothing: measured on a getter that did exactly that to save creation work, the effect below
 * ran once and never again, and `<vera-checkbox>` ignored an `indeterminate` attribute added after creation (it reads
 * the attribute inside its layout effect). Any cut to the first read's cost must keep these rows green. jsdom, through
 * the built bundles, both builds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
const { define, html, wire, flush, effect } = await load('core');
const { renderer } = await load('renderer');
wire([renderer]);
const settle = async () => {
  flush();
  await new Promise((resolve) => setTimeout(resolve, 10));
  flush();
};

test("an effect reading a declared attribute's default re-runs when the attribute is set later", async () => {
  const runs = [];
  define({ tag: 'x-reactive-attr', attributes: ['tone'] }, (host) => {
    effect(() => {
      runs.push(host.tone);
    });
    return undefined;
  });
  const element = document.createElement('x-reactive-attr');
  document.body.append(element);
  await settle();
  assert.deepEqual(runs, [null], 'CONTROL: the effect ran once and read the default');
  element.setAttribute('tone', 'loud');
  await settle();
  assert.deepEqual(runs, [null, 'loud'], 'the first read subscribed: the attribute set later re-ran the effect');
  element.remove();
});

test("an effect reading a declared prop's default re-runs when the property is written later", async () => {
  const runs = [];
  define({ tag: 'x-reactive-prop', props: { count: 0 } }, (host) => {
    effect(() => {
      runs.push(host.count);
    });
    return undefined;
  });
  const element = document.createElement('x-reactive-prop');
  document.body.append(element);
  await settle();
  assert.deepEqual(runs, [0], 'CONTROL: the effect ran once and read the default');
  element.count = 5;
  await settle();
  assert.deepEqual(runs, [0, 5], 'the first read subscribed: the property written later re-ran the effect');
  element.remove();
});

test("a render reading a declared default re-renders when the property is written later", async () => {
  define({ tag: 'x-reactive-render', props: { label: 'first' } }, (host) => () => html`<b>${host.label}</b>`);
  const element = document.createElement('x-reactive-render');
  document.body.append(element);
  await settle();
  assert.equal(element.textContent, 'first', 'CONTROL: the default rendered');
  element.label = 'second';
  await settle();
  assert.equal(element.textContent, 'second', 'the first render subscribed: the property written later re-rendered it');
  element.remove();
});

test('<vera-checkbox>: an indeterminate attribute added after creation reaches the input, and its removal clears it', async () => {
  await load('vera-components/checkbox');
  const box = document.createElement('vera-checkbox');
  box.innerHTML = '<input type="checkbox">';
  document.body.append(box);
  await settle();
  const input = box.querySelector('input');
  assert.equal(input.hasAttribute('data-vera-checkbox'), true, 'CONTROL: the checkbox served its input');
  assert.equal(input.indeterminate, false, 'CONTROL: not mixed at creation');
  box.setAttribute('indeterminate', '');
  await settle();
  assert.equal(input.indeterminate, true, 'the checkbox heard indeterminate added after creation');
  box.removeAttribute('indeterminate');
  await settle();
  assert.equal(input.indeterminate, false, 'and its removal');
  box.remove();
});
