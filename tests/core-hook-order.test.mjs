/**
 * **A component's hooks run in ONE order — priority, then creation — however they were registered** (work queue 5,
 * 2026-10-11). The hooks live in one flat list, kept sorted as each joins: a hook joins at the end unless a LOWER
 * priority arrives after a higher one, which moves back past the hooks that run after it. The scheduler orders every
 * flush by the same key on its own, so the list's order is what the FIRST pass follows.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>');
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key] ?? globalThis[key];
const core = await load('core');
const { renderer } = await load('renderer');
core.wire([renderer]);
const doc = dom.window.document;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
let seq = 0;

test('a lower priority registered AFTER a higher one still runs first on the first pass', async () => {
  const order = [];
  const tag = `ho-${seq++}`;
  customElements.define(tag, class extends HTMLElement {
    connectedCallback() {
      core.init(this, () => {
        core.useEffect(() => { order.push('effect 75'); });
        core.useHook(() => { order.push('hook 25'); }, 25);
        core.useLayoutEffect(() => { order.push('layout 60'); });
        return () => { order.push('render 50'); return core.html`<p>x</p>`; };
      });
    }
  });
  const el = doc.createElement(tag);
  doc.body.append(el);
  await tick();
  assert.deepEqual(order, ['hook 25', 'render 50', 'layout 60', 'effect 75']);
  el.remove();
});
