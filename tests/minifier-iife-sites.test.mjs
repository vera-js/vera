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
import { iifes } from './iife-count.mjs';
import { packageDirs } from '../scripts/packages.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const PINS = {
  'packages/autoloader/dist/vera-autoloader.min.js': 0,
  'packages/cms/dist/vera-cms-cli.min.js': 12,
  'packages/cms/dist/vera-cms-content.min.js': 1,
  'packages/cms/dist/vera-cms-node.min.js': 9,
  'packages/cms/dist/vera-cms-publish.min.js': 2,
  'packages/core/dist/vera.min.js': 12,
  /** The lite tier: every site COLD, on `instantiate`'s per-call-site cache miss — `prepare` and the forged-template check
   *  `genuine` (2; 2026-11-23: `literal` has a second caller, a template inside text, so it is a kept function, no
   *  longer pasted into `genuine`). The hot calls (commit, the attribute checks, retire, `patch` in `render`) are kept
   *  calls by annotation. */
  'packages/lite/dist/vera-lite.min.js': 2,
  /**
   * The static tier (2026-11-18): it renders ONCE per element, so it has no hot path — counted so a new inlined function
   * is seen. 1: `renderInto`, `connectedCallback`'s one call, pasted in (run once per element).
   */
  'packages/static/dist/vera-static.min.js': 1,
  'packages/directives/dist/vera-directives-core.min.js': 13,
  'packages/directives/dist/vera-directives-expressions.min.js': 0,
  'packages/directives/dist/vera-directives-interactions.min.js': 1,
  'packages/directives/dist/vera-directives-motion.min.js': 46,
  'packages/directives/dist/vera-directives-query.min.js': 6,
  'packages/directives/dist/vera-directives-remote.min.js': 3,
  'packages/directives/dist/vera-directives-sensors.min.js': 3,
  'packages/directives/dist/vera-directives-standalone.min.js': 26,
  'packages/directives/dist/vera-directives.min.js': 83,
  'packages/components/field/dist/vera-field-element.min.js': 11,
  'packages/components/field/dist/vera-field.min.js': 11,
  'packages/components/icon/dist/vera-icon-element.min.js': 2,
  'packages/components/icon/dist/vera-icon.min.js': 2,
  'packages/components/kbd/dist/vera-kbd-element.min.js': 4,
  'packages/components/kbd/dist/vera-kbd.min.js': 6,
  'packages/components/select/dist/vera-select-elements.min.js': 2,
  'packages/components/spinner/dist/vera-spinner-element.min.js': 1,
  'packages/components/input/dist/vera-input-element.min.js': 8,
  'packages/components/input/dist/vera-input.min.js': 8,
  /** 3 (2026-11-25, new): the stepper's parts and its adoptOwnSheet, one caller each, run once per number input served (never per frame), and the box selector its sheet builds once, at load. */
  'packages/components/input/dist/vera-input-stepper.min.js': 3,
  'packages/components/spinner/dist/vera-spinner.min.js': 1,
  'packages/components/dialog/dist/vera-dialog-element.min.js': 1,
  'packages/components/dialog/dist/vera-dialog.min.js': 1,
  'packages/components/menu/dist/vera-menu-element.min.js': 2,
  'packages/components/menu/dist/vera-menu.min.js': 2,
  'packages/components/tabs/dist/vera-tabs-element.min.js': 1,
  'packages/components/tabs/dist/vera-tabs.min.js': 1,
  'packages/components/select/dist/vera-select.min.js': 3,
  'packages/hooks/light-dismiss/dist/vera-light-dismiss.min.js': 0,
  'packages/hooks/typeahead/dist/vera-typeahead.min.js': 0,
  'packages/hooks/anchor/dist/vera-anchor.min.js': 2,
  'packages/hooks/announce/dist/vera-announce.min.js': 3,
  'packages/hooks/labeled/dist/vera-labeled.min.js': 4,
  'packages/hooks/roving-focus/dist/vera-roving-focus-internal.min.js': 1,
  'packages/hooks/roving-focus/dist/vera-roving-focus.min.js': 2,
  'packages/hooks/listbox/dist/vera-listbox.min.js': 3,
  'packages/hot/dist/vera-hot-vite.min.js': 0,
  'packages/hot/dist/vera-hot.min.js': 2,
  'packages/inserts/dist/vera-inserts.min.js': 0,
  'packages/jsx/dist/vera-jsx-standalone.min.js': 7,
  'packages/jsx/dist/vera-jsx.min.js': 3,
  'packages/motion/dist/vera-motion-client.min.js': 5,
  'packages/motion/dist/vera-motion-internal.min.js': 34,
  'packages/motion/dist/vera-motion-ssr.min.js': 15,
  'packages/motion/dist/vera-motion.min.js': 16,
  'packages/renderer/dist/vera-renderer-elements.min.js': 4,
  'packages/renderer/dist/vera-renderer-hydrate-slots.min.js': 0,
  'packages/renderer/dist/vera-renderer-hydration.min.js': 2,
  'packages/renderer/dist/vera-renderer-keyed.min.js': 0,
  'packages/renderer/dist/vera-renderer-multi-window.min.js': 1,
  'packages/renderer/dist/vera-renderer-namespaces.min.js': 0,
  'packages/renderer/dist/vera-renderer-native-elements.min.js': 1,
  'packages/renderer/dist/vera-renderer-portal.min.js': 0,
  'packages/renderer/dist/vera-renderer-slots.min.js': 11,
  'packages/renderer/dist/vera-renderer-spread.min.js': 1,
  'packages/renderer/dist/vera-renderer-tag.min.js': 1,
  'packages/renderer/dist/vera-renderer-until.min.js': 0,
  'packages/renderer/dist/vera-renderer.min.js': 4,
  'packages/router/dist/vera-router.min.js': 12,
  /** 3 → 4 (D29, 2026-11-12): warnOnce/errorOnce are built by one factory, inlined here. A private bundle (inlined into
   *  every package, never shipped), and in every shipped bundle the factory reaches development code only. */
  'packages/shared-utils/dist/vera-shared-utils.min.js': 9, // 4 → 8 (2026-11-17): define's four development checks moved here from core (checkDefine, checkMethods, checkProps, checkAttributes, one caller each, inlined in this private bundle only; core and lite drop them in production); 8 → 9 (2026-11-18): the wrong-namespace check moved here from the renderer (foreignHost, one caller, checkForeign; development-only in every consumer, so no shipped production bundle carries it)
  'packages/store/dist/vera-store-collections.min.js': 1,
  'packages/store/dist/vera-store-resource.min.js': 0,
  'packages/store/dist/vera-store.min.js': 1,
  'packages/styles/dist/vera-styles.min.js': 1,
};

const bundles = packageDirs().flatMap((pkg) => {
  const dir = `${pkg}/dist`;
  return existsSync(join(root, dir)) ? readdirSync(join(root, dir)).filter((f) => f.endsWith('.min.js')).map((f) => `${dir}/${f}`) : [];
});

test('every production bundle is pinned, and every pin names a bundle that exists', () => {
  assert.ok(bundles.length > 20, `CONTROL: found only ${bundles.length} production bundles — is the tree built?`);
  assert.deepEqual(bundles.filter((b) => !(b in PINS)), [], 'a new bundle needs its pin');
  assert.deepEqual(Object.keys(PINS).filter((b) => !bundles.includes(b)), [], 'a pin names a bundle that no longer exists');
});

test('CONTROL: the counter sees exactly the invoked shapes — a wrapped call argument is 0, both IIFE forms are 1, a brace in a template literal confuses nothing', () => {
  assert.equal(iifes('n((o=>{x()}),{p:50})'), 0, 'a call argument terser wrapped in parentheses');
  assert.equal(iifes('a=((t,e)=>{x()})(1,2)'), 1, 'the two-parenthesis form');
  assert.equal(iifes('a=(t=>{x()})(1)'), 1, 'the one-parenthesis form');
  assert.equal(iifes('a=(t=>{const s=`}${"}"}`;return s})(1)'), 1, 'a } inside a template literal and a string');
  assert.equal(iifes('a=(t=>{if(t){}})(1),b=(()=>{})'), 1, 'nested braces; an arrow not invoked');
});

test('no production bundle grew an inlined single-use function (each count exactly as pinned)', () => {
  const counts = Object.fromEntries(bundles.map((b) => [b, iifes(readFileSync(join(root, b), 'utf8'))]));
  assert.ok(Object.values(counts).some((n) => n > 0), 'CONTROL: the pattern matched nothing anywhere — it cannot see the shape');
  const changed = bundles.filter((b) => counts[b] !== PINS[b]).map((b) => `${b}: ${PINS[b]} pinned, ${counts[b]} now`);
  assert.deepEqual(changed, [], 'a higher count is a new inlined single-use function — race it headed on three engines first (a lower one: lower the pin)');
});

/**
 * **No doc comment ships in a production bundle** (2026-10-24): terser keeps any comment that carries an annotation, so
 * a why-comment that SPELLED the no-inline mark beside the call it explains shipped whole — three lines of prose, 240 B
 * gzip, in `vera-renderer.min.js`. Pinned like the IIFEs, exact: the only ones today are a CSS comment inside a style
 * string in `components/select` (string content terser cannot strip — real bytes, logged for the ui pass).
 */
const DOC = /\/\*\*/g;
const DOC_PINS = { 'packages/components/select/dist/vera-select-elements.min.js': 1, 'packages/components/select/dist/vera-select.min.js': 1 };
test('no doc comment survives into a production bundle (each count exactly as pinned)', () => {
  assert.ok(('x /** y */ z'.match(DOC) ?? []).length === 1, 'CONTROL: the pattern sees a doc comment');
  const off = bundles
    .map((b) => [b, (readFileSync(join(root, b), 'utf8').match(DOC) ?? []).length])
    .filter(([b, n]) => n !== (DOC_PINS[b] ?? 0))
    .map(([b, n]) => `${b}: ${DOC_PINS[b] ?? 0} pinned, ${n} found`);
  assert.deepEqual(off, [], 'a doc comment shipped (a why-comment spelling an annotation keeps the whole comment)');
});

