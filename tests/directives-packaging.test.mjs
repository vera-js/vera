/**
 * The §16b packaging claims, asserted rather than trusted.
 *
 * **Substrate adoption** is the page-B scenario promoted to a feature: `vera.min.js` and
 * `vera-directives.min.js` (which bakes its own copy of core's store machinery) loaded together
 * used to mean two store registries — a component and a directive writing the "same" key and
 * never notifying each other. Core's `wire()` now stamps `Symbol.for('vera.core')` with the copy
 * the app actually uses, and the engine adopts it at first activation. The production run of
 * this file is the real test — that is the only build where two copies exist to reconcile; the
 * development run holds one shared core and passes structurally.
 *
 * **The shaking test** is the tree-shakeability claim measured: the root entry re-exports
 * everything, and naming only what you use must be what you pay for. Verified under Rollup —
 * which is the claim the docs are allowed to make, no wider. Both directions are asserted,
 * because a probe that measures nothing reports perfect behaviour: the marker must be ABSENT
 * from the lean bundle and PRESENT in the full one, or the marker itself has drifted.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent',
  'MutationObserver', 'CSSStyleSheet']) globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

/** ORDER IS THE POINT: core wires (and stamps) BEFORE the engine's first activation snapshot. */
const { wire, createHook } = await load('core');
wire([]);
const { wireDirectives, interactions, expressions, settled, stateOf } = await load('directives');
wireDirectives([expressions, ...interactions]);

const doc = dom.window.document;

test('adoption: a directive write notifies a hook made by the PAGE core (one registry)', async () => {
  const stamp = globalThis[Symbol.for('vera.core')];
  assert.equal(typeof stamp?.createStore, 'function', 'wire() stamped the substrate');
  assert.equal(typeof stamp?.createHook, 'function');

  const host = doc.createElement('div');
  host.innerHTML = `
    <div data-vd-state="{ n: 1 }">
      <button data-vd-on-click="{ n: n + 1 }">+</button>
      <output data-vd-text="n"></output>
    </div>`;
  doc.body.appendChild(host);
  await settled();

  const carrier = host.querySelector('[data-vd-state]');
  const store = stateOf(carrier);
  assert.equal(store.n, 1, 'the carrier activated');

  /** Subscribe through the OUTER core — the component side of page B. If the engine had used its
   *  baked copy, this hook would subscribe into a registry the directive never writes to. */
  const seen = [];
  const run = createHook({
    element: /** @type {HTMLElement} */ ({}),
    priority: 30,
    callback: () => {
      seen.push(store.n);
    },
  });
  run?.(undefined, true);
  await settled();
  assert.deepEqual(seen, [1], 'the control: the hook ran and read the store at all');

  host.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, composed: true }));
  await settled();
  assert.equal(host.querySelector('output').textContent, '2', 'the directive side updated');
  assert.equal(seen.at(-1), 2, 'and the page-core hook was notified — ONE registry, page B is fixed');
});

test('shaking: naming only the engine and interaction drops the expression tier (Rollup)', async () => {
  const { rollup } = await import('rollup');
  const dev = new URL('../packages/directives/dist/development/vera-directives.js', import.meta.url).pathname;
  const bundleOf = async (source) => {
    const build = await rollup({
      input: 'probe',
      external: ['@verajs/core'],
      onwarn: () => {},
      plugins: [{
        name: 'virtual-probe',
        resolveId: (id) => (id === 'probe' ? id : id === '@verajs/directives' ? dev : null),
        load: (id) => (id === 'probe' ? source : null),
      }],
    });
    const { output } = await build.generate({ format: 'esm' });
    return output[0].code;
  };

  /**
   * `parseTier` is a FUNCTION NAME declared only in `expressions.ts`, and the marker is an
   * identifier rather than a string for a reason worth keeping: this test used to look for
   * `'strict-spelling'`, that tier's `===` teaching refusal, until the diagnostics table moved
   * every code into one module the ENGINE imports — so the string appeared in a bundle that
   * contains none of the tier's code, and the proxy failed while the claim it stands for was still
   * true. A code is now shared vocabulary; only the implementation is exclusive.
   */
  const lean = await bundleOf(`import { wireDirectives, interactions } from '@verajs/directives'; wireDirectives(interaction);`);
  const full = await bundleOf(`import { wireDirectives, interactions, expressions } from '@verajs/directives'; wireDirectives([expressions, ...interactions]);`);
  assert.ok(full.includes('parseTier'), 'the control: the marker exists when expressions IS imported');
  assert.ok(!lean.includes('parseTier'), 'the claim: unimported packs cost nothing under Rollup');
  /** Motion is the pack with real stakes — 18KB of the root when it rides along. */
  const withMotion = await bundleOf(`import { wireDirectives, motion } from '@verajs/directives'; wireDirectives([motion]);`);
  assert.ok(withMotion.includes('vd:motion'), 'the control: motion marks its bundle when imported');
  assert.ok(!lean.includes('vd:motion'), 'and costs nothing when it is not');
  assert.ok(lean.includes('data-vd-'), 'and the engine itself was retained');
});
