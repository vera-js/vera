/**
 * The structural properties other packages read off a live component element.
 *
 * Two packages reach into core's elements without importing core: `@verajs/styles` falls back to
 * `element._$r$` for a closed shadow root, and `@verajs/directives`' init connector reads
 * `_$r$` for the root to activate (the retired `@verajs/motion` adapter read both names, and
 * `_$c$` was missing from the mangle exemptions until 2026-09-01 — every production build
 * drained a renamed set while cleanups registered on a property nothing read, silently). Neither
 * name can survive core's production property-mangling renaming it; `_$c$` stays asserted
 * because it is the release half of the same contract and the next consumer should find it live.
 *
 * This suite runs against both artifacts, so the production run is the one that would fail if the
 * exemption list rots again. Asserted on a live element rather than by grepping the bundle: the
 * contract is that the *behavior* reaches these names, not that the strings appear somewhere.
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

  assert.ok(element._$c$ instanceof Set, '_cleanups must be a Set the adapter can add to');
  assert.ok(element._$r$ && typeof element._$r$.querySelectorAll === 'function',
    '_root must be the shadow root the adapter hands to observe()');

  /** And the drain reads the same name it wrote: an externally-added cleanup runs on disconnect. */
  let released = 0;
  element._$c$.add(() => released++);
  element.remove();
  assert.equal(released, 1, 'a cleanup registered structurally must run on disconnect');
});
