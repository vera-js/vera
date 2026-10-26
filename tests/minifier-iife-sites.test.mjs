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
/**
 * **Counts arrows IMMEDIATELY INVOKED where they are defined** — the terser shape of an inlined single-use function,
 * `((a,b)=>{…})(x,y)` and `(t=>{…})(x)`: from each arrow's opening, its body is matched brace by brace (string and
 * template literals skipped, `${}` nested) and counted only when `)(` follows it (2026-10-25, vera-5a). The pattern it
 * replaced, any `((…)=>{` start, counted call ARGUMENTS terser wraps in parentheses (`n((o=>{…}),…)`) and missed the
 * one-parenthesis form, so its pins mixed two things: portal's "2" was two wrapped arguments, motion's "7" hid five
 * real sites. Its positive control, run on the real case: core built BEFORE the two `@__NOINLINE__` annotations counts 12,
 * and with them 10 — exactly the two sites that cost Firefox.
 */
const OPEN = /\((?:\([\w$,]*\)|[\w$]+)=>\{/g;
const iifes = (src) => {
  let n = 0;
  for (const m of src.matchAll(OPEN)) {
    let i = m.index + m[0].length, depth = 1;
    const skipString = (q) => { i++; while (i < src.length && src[i] !== q) i += src[i] === '\\' ? 2 : 1; i++; };
    const skipTemplate = () => {
      i++;
      while (i < src.length && src[i] !== '`') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') {
          i += 2;
          let d = 1;
          while (i < src.length && d > 0) {
            const c = src[i];
            if (c === '"' || c === "'") { skipString(c); continue; }
            if (c === '`') { skipTemplate(); continue; }
            if (c === '{') d++;
            else if (c === '}') d--;
            i++;
          }
          continue;
        }
        i++;
      }
      i++;
    };
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '"' || c === "'") { skipString(c); continue; }
      if (c === '`') { skipTemplate(); continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      i++;
    }
    if (src[i] === ')' && src[i + 1] === '(') n++;
  }
  return n;
};
const PINS = {
  'packages/autoloader/dist/vera-autoloader.min.js': 0,
  'packages/cms/dist/vera-cms-cli.min.js': 5,
  'packages/cms/dist/vera-cms-content.min.js': 0,
  'packages/cms/dist/vera-cms-node.min.js': 5,
  'packages/cms/dist/vera-cms-publish.min.js': 1,
  'packages/core/dist/vera.min.js': 10,
  'packages/directives/dist/vera-directives-core.min.js': 11,
  'packages/directives/dist/vera-directives-expressions.min.js': 0,
  'packages/directives/dist/vera-directives-interactions.min.js': 0,
  'packages/directives/dist/vera-directives-motion.min.js': 37,
  'packages/directives/dist/vera-directives-query.min.js': 5,
  'packages/directives/dist/vera-directives-remote.min.js': 3,
  'packages/directives/dist/vera-directives-sensors.min.js': 1,
  'packages/directives/dist/vera-directives-standalone.min.js': 23,
  'packages/directives/dist/vera-directives.min.js': 70,
  'packages/hooks/dist/vera-hooks.min.js': 3,
  'packages/hot/dist/vera-hot.min.js': 2,
  'packages/inserts/dist/vera-inserts.min.js': 0,
  'packages/jsx/dist/vera-jsx-standalone.min.js': 3,
  'packages/jsx/dist/vera-jsx.min.js': 3,
  'packages/motion/dist/vera-motion-client.min.js': 4,
  'packages/motion/dist/vera-motion-internal.min.js': 29,
  'packages/motion/dist/vera-motion-ssr.min.js': 11,
  'packages/motion/dist/vera-motion.min.js': 12,
  'packages/renderer/dist/vera-renderer-elements.min.js': 2,
  'packages/renderer/dist/vera-renderer-hydrate-slots.min.js': 0,
  'packages/renderer/dist/vera-renderer-hydration.min.js': 2,
  'packages/renderer/dist/vera-renderer-keyed.min.js': 0,
  'packages/renderer/dist/vera-renderer-namespaces.min.js': 0,
  'packages/renderer/dist/vera-renderer-native-elements.min.js': 1,
  'packages/renderer/dist/vera-renderer-portal.min.js': 0,
  'packages/renderer/dist/vera-renderer-slots.min.js': 9,
  'packages/renderer/dist/vera-renderer-spread.min.js': 0,
  'packages/renderer/dist/vera-renderer-tag.min.js': 0,
  'packages/renderer/dist/vera-renderer.min.js': 4,
  'packages/router/dist/vera-router.min.js': 10,
  'packages/shared-utils/dist/vera-shared-utils.min.js': 3,
  'packages/store/dist/vera-store-collections.min.js': 1,
  'packages/store/dist/vera-store-resource.min.js': 0,
  'packages/store/dist/vera-store.min.js': 1,
  'packages/styles/dist/vera-styles.min.js': 0,
  'packages/ui/dist/vera-ui-elements.min.js': 2,
  'packages/ui/dist/vera-ui.min.js': 3,
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
 * string in `ui` (string content terser cannot strip — real bytes, logged for the ui pass).
 */
const DOC = /\/\*\*/g;
const DOC_PINS = { 'packages/ui/dist/vera-ui-elements.min.js': 1, 'packages/ui/dist/vera-ui.min.js': 1 };
test('no doc comment survives into a production bundle (each count exactly as pinned)', () => {
  assert.ok(('x /** y */ z'.match(DOC) ?? []).length === 1, 'CONTROL: the pattern sees a doc comment');
  const off = bundles
    .map((b) => [b, (readFileSync(join(root, b), 'utf8').match(DOC) ?? []).length])
    .filter(([b, n]) => n !== (DOC_PINS[b] ?? 0))
    .map(([b, n]) => `${b}: ${DOC_PINS[b] ?? 0} pinned, ${n} found`);
  assert.deepEqual(off, [], 'a doc comment shipped (a why-comment spelling an annotation keeps the whole comment)');
});

