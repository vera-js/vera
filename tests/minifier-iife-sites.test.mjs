/**
 * **Inlined single-use functions in the production bundles, counted** (2026-10-23). The minifier pastes a function that
 * has ONE caller into that caller as an immediately-invoked arrow (`((a,b)=>{…})(x,y)`), building a function object on
 * every call. A refactor that removed two exports left two of core's render-path helpers with one caller each, and the
 * resulting IIFEs cost headed Firefox ~1–2% on component creation and churn — in no source diff, since the hot code
 * itself was unchanged (`docs/BROWSER-LEDGER.md`, "The minifier inlines a function with ONE caller"). The fix was
 * terser's `@__NOINLINE__` annotation at the two calls; this pins every bundle's count so the NEXT such site is a deliberate, raced edit:
 * a higher count fails until the change is measured on the engines and the pin raised; a lower one asks for the pin to
 * be lowered, so the numbers stay exact (as the size claims do).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
/** The terser output shape of an inlined single-use function: an arrow invoked where it is defined. */
const IIFE = /\(\((\(?[a-zA-Z$_,]*\)?)=>\{/g;
const PINS = {
  'packages/autoloader/dist/vera-autoloader.min.js': 2,
  'packages/cms/dist/vera-cms-cli.min.js': 3,
  'packages/cms/dist/vera-cms-content.min.js': 2,
  'packages/cms/dist/vera-cms-node.min.js': 3,
  'packages/cms/dist/vera-cms-publish.min.js': 3,
  'packages/core/dist/vera.min.js': 13,
  'packages/directives/dist/vera-directives-core.min.js': 8,
  'packages/directives/dist/vera-directives-expressions.min.js': 1,
  'packages/directives/dist/vera-directives-interactions.min.js': 1,
  'packages/directives/dist/vera-directives-motion.min.js': 42,
  'packages/directives/dist/vera-directives-query.min.js': 4,
  'packages/directives/dist/vera-directives-remote.min.js': 5,
  'packages/directives/dist/vera-directives-sensors.min.js': 7,
  'packages/directives/dist/vera-directives-standalone.min.js': 20,
  'packages/directives/dist/vera-directives.min.js': 78,
  'packages/hooks/dist/vera-hooks.min.js': 2,
  'packages/hot/dist/vera-hot.min.js': 3,
  'packages/inserts/dist/vera-inserts.min.js': 0,
  'packages/jsx/dist/vera-jsx-standalone.min.js': 3,
  'packages/jsx/dist/vera-jsx.min.js': 2,
  'packages/motion/dist/vera-motion-client.min.js': 1,
  'packages/motion/dist/vera-motion-internal.min.js': 28,
  'packages/motion/dist/vera-motion-ssr.min.js': 7,
  'packages/motion/dist/vera-motion.min.js': 7,
  'packages/renderer/dist/vera-renderer-elements.min.js': 2,
  'packages/renderer/dist/vera-renderer-hydrate-slots.min.js': 0,
  'packages/renderer/dist/vera-renderer-hydration.min.js': 2,
  'packages/renderer/dist/vera-renderer-keyed.min.js': 0,
  'packages/renderer/dist/vera-renderer-namespaces.min.js': 0,
  'packages/renderer/dist/vera-renderer-native-elements.min.js': 0,
  'packages/renderer/dist/vera-renderer-portal.min.js': 1,
  'packages/renderer/dist/vera-renderer-slots.min.js': 10,
  'packages/renderer/dist/vera-renderer-spread.min.js': 0,
  'packages/renderer/dist/vera-renderer-tag.min.js': 0,
  'packages/renderer/dist/vera-renderer.min.js': 4,
  'packages/router/dist/vera-router.min.js': 13,
  'packages/shared-utils/dist/vera-shared-utils.min.js': 2,
  'packages/store/dist/vera-store-collections.min.js': 0,
  'packages/store/dist/vera-store-resource.min.js': 2,
  'packages/store/dist/vera-store.min.js': 2,
  'packages/styles/dist/vera-styles.min.js': 0,
  'packages/ui/dist/vera-ui-elements.min.js': 10,
  'packages/ui/dist/vera-ui.min.js': 11,
};

const bundles = readdirSync(join(root, 'packages'), { withFileTypes: true }).filter((d) => d.isDirectory()).flatMap((d) => {
  const dir = `packages/${d.name}/dist`;
  return existsSync(join(root, dir)) ? readdirSync(join(root, dir)).filter((f) => f.endsWith('.min.js')).map((f) => `${dir}/${f}`) : [];
});

test('every production bundle is pinned, and every pin names a bundle that exists', () => {
  assert.ok(bundles.length > 20, `CONTROL: found only ${bundles.length} production bundles — is the tree built?`);
  assert.deepEqual(bundles.filter((b) => !(b in PINS)), [], 'a new bundle needs its pin');
  assert.deepEqual(Object.keys(PINS).filter((b) => !bundles.includes(b)), [], 'a pin names a bundle that no longer exists');
});

test('no production bundle grew an inlined single-use function (each count exactly as pinned)', () => {
  const counts = Object.fromEntries(bundles.map((b) => [b, (readFileSync(join(root, b), 'utf8').match(IIFE) ?? []).length]));
  assert.ok(Object.values(counts).some((n) => n > 0), 'CONTROL: the pattern matched nothing anywhere — it cannot see the shape');
  const changed = bundles.filter((b) => counts[b] !== PINS[b]).map((b) => `${b}: ${PINS[b]} pinned, ${counts[b]} now`);
  assert.deepEqual(changed, [], 'a higher count is a new inlined single-use function — race it headed on three engines first (a lower one: lower the pin)');
});
