/**
 * The vera adapter against the REAL framework — built artifacts, both runs.
 *
 * `@verajs/motion/vera` is covered in its own package by a stand-in for
 * `wire()` and the `'init'` insert, deliberately (motion's library must not
 * import core). A stand-in encodes assumptions, and the two contracts it
 * assumes — that `wire()` calls `connect()` and hands every component element
 * to the `'init'` chain, and that `_root`/`_cleanups` reach a live element
 * under those names — are exactly what this suite exercises with the real
 * packages. The production run is the one that matters: core mangles
 * `_`-prefixed properties there, motion's vera bundle keeps the runtime
 * external, and this is the only test in either repo that drives the whole
 * chain as npm ships it.
 *
 * A closed shadow root on purpose: `element.shadowRoot` is null for one, so
 * an element animating inside it is something nothing outside the handoff
 * could have discovered — the adapter's whole reason to exist.
 */
import { load } from './dist.mjs';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const dom = new JSDOM('<body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Element', 'customElements',
                   'CSSStyleSheet', 'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame',
                   'getComputedStyle', 'MutationObserver', 'Event', 'CustomEvent'])
  globalThis[key] = dom.window[key];

const frame = () => new Promise((resolve) => dom.window.requestAnimationFrame(() => resolve()));

const { init, wire, render, html } = await load('core');
const { renderer } = await load('renderer');
const { motion } = await load('motion/vera');

test('a marked element inside a real closed shadow root animates through the adapter', async () => {
  wire([renderer, motion]);

  customElements.define('x-motion-host', class extends dom.window.HTMLElement {
    connectedCallback() {
      init(this, { mode: 'closed' });
      render(() => html`
        <div id="inner" data-vera-motion data-vera-motion-translate-y="0% 0px, 100% 40px"></div>
      `);
    }
  });

  const host = dom.window.document.createElement('x-motion-host');
  dom.window.document.body.append(host);
  await frame();
  await frame();

  const instance = motion.instance;
  assert.ok(instance, 'wire() must have run connect(), which starts the instance');

  /** The closed root is reachable only through the handoff this asserts. */
  const inner = [...instance.elements].map((e) => e.node).find((n) => n.id === 'inner');
  assert.ok(inner, 'the element inside the closed root must have been adopted');
  assert.match(inner.style.transform, /translateY\(/,
    'and painted — the control that the whole chain ran, not merely registered');

  /**
   * The matching release: disconnect drains `_cleanups`, whose entry calls
   * `unobserve(root)`. In production this is the pair of names the mangle
   * exemptions protect; a rotted exemption strands the root and this count.
   */
  const before = instance.elements.length;
  assert.ok(before >= 1);
  host.remove();
  await frame();
  instance.collect();
  assert.equal(
    [...instance.elements].some((e) => e.node.id === 'inner'), false,
    'a disconnected component gives its elements back'
  );
});
