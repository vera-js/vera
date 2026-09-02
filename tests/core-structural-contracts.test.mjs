/**
 * The structural properties other packages read off a live component element.
 *
 * Two packages reach into core's elements without importing core: `@verajs/styles` falls back to
 * `element._root` for a closed shadow root, and `@verajs/motion`'s vera adapter reads `_root` for
 * the root to observe and `_cleanups` for the matching release on unmount. Neither can survive
 * core's production property-mangling renaming those fields — and `_cleanups` was missing from the
 * mangle exemptions until 2026-09-01, so every production build drained a renamed set while the
 * adapter registered its cleanup on a property nothing read: roots were never unobserved, in
 * production only, silently (the adapter's read is optional-chained by design).
 *
 * This suite runs against both artifacts, so the production run is the one that would fail if the
 * exemption list rots again. Asserted on a live element rather than by grepping the bundle: the
 * contract is that the *behaviour* reaches these names, not that the strings appear somewhere.
 */
import { load } from './dist.mjs';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const dom = new JSDOM('<body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Element', 'customElements',
                   'CSSStyleSheet', 'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];

const { init } = await load('core');

test('a component element carries _root and _cleanups under their unmangled names', async () => {
  customElements.define('x-contract', class extends dom.window.HTMLElement {
    connectedCallback() { init(this, { mode: 'open' }); }
  });
  const element = dom.window.document.createElement('x-contract');
  dom.window.document.body.append(element);

  assert.ok(element._cleanups instanceof Set, '_cleanups must be a Set the adapter can add to');
  assert.ok(element._root && typeof element._root.querySelectorAll === 'function',
    '_root must be the shadow root the adapter hands to observe()');

  /** And the drain reads the same name it wrote: an externally-added cleanup runs on disconnect. */
  let released = 0;
  element._cleanups.add(() => released++);
  element.remove();
  assert.equal(released, 1, 'a cleanup registered structurally must run on disconnect');
});
