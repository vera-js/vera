/**
 * **The inverse of `tests/docs-imports.test.mjs`: an export nobody documented.**
 *
 * That file asks whether every documented name exists. This one asks whether every name that exists
 * is documented — which is the question that catches an internal escaping into a published entry
 * point, where it becomes a compatibility promise nobody meant to make and nobody can find.
 *
 * It is a weak check by construction: a name mentioned anywhere in any `.md` or `.txt` counts.
 * That is deliberate. The point is not to police how well a thing is written up, only to make a
 * *silent* export impossible — adding one to the public surface now requires writing its name down
 * somewhere, which is the moment to notice you did not mean to export it.
 *
 * Two real leaks were found by running this the first time: `@verajs/reactivity`'s `collectionMethod`
 * and `GLOBAL`, which are the `'collection'` extension point and are the only way to implement one,
 * and `@verajs/renderer/tag`'s `jsxName` and `BOOLEAN_ATTRIBUTES`, which exist so
 * `tests/jsx-name-mapping.test.mjs` can hold them against `@verajs/jsx`'s deliberate second copy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { walkFiles, readIfPresent } from './walk.mjs';
import { JSDOM } from 'jsdom';
import { distUrl, isProduction, NO_PRODUCTION_BUILD } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment', 'Event', 'CustomEvent', 'MouseEvent', 'PopStateEvent', 'NodeFilter', 'Comment', 'Text', 'MutationObserver', 'ShadowRoot', 'Document', 'location', 'history', 'performance'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = (fn) => dom.window.setTimeout(() => fn(0), 0);
globalThis.cancelAnimationFrame = (id) => dom.window.clearTimeout(id);

/** Every published entry point, by the specifier a consumer writes. */
const PACKAGES = {
  '@verajs/core': 'core',
  '@verajs/renderer': 'renderer',
  '@verajs/renderer/keyed': 'renderer/keyed',
  '@verajs/renderer/slots': 'renderer/slots',
  '@verajs/renderer/spread': 'renderer/spread',
  '@verajs/renderer/hydrate': 'renderer/hydrate',
  '@verajs/renderer/tag': 'renderer/tag',
  '@verajs/renderer/profiler': 'renderer/profiler',
  '@verajs/router': 'router',
  '@verajs/autoloader': 'autoloader',
  '@verajs/styles': 'styles',
  '@verajs/reactivity': 'reactivity',
  '@verajs/reactivity/computed': 'reactivity/computed',
  '@verajs/reactivity/collections': 'reactivity/collections',
  '@verajs/inserts': 'inserts',
  '@verajs/jsx': 'jsx',
};

/**
 * Resolved from source rather than a bundle, because these publish their `src` directly — the same
 * two `docs-imports` treats this way, and for the same reason. They were left out of this check
 * entirely until `@verajs/ssr`'s `hoistedStyles` turned up in the public surface with no mention
 * anywhere: an internal `Map` of hoisted `@scope` blocks that `renderToString` already returns the
 * relevant half of.
 */
const SOURCE_PACKAGES = {
  '@verajs/ssr': '../packages/ssr/src/vera/index.js',
};

const root = new URL('..', import.meta.url).pathname;
const docs = [];
/** `internal/` is a separate private repo cloned in here, and is not documentation of this one. */
docs.push(
  ...walkFiles(root, /\.(md|txt)$/, {
    ignore: ['node_modules', 'dist', '.git', 'internal', '.wireit', '.changeset'],
  }).filter((file) => !/CHANGELOG/i.test(file))
);

const prose = docs.map(readIfPresent).filter((text) => text !== null).join('\n');

test('the docs are actually being read', () => {
  assert.ok(docs.length > 10, `expected the documentation, found ${docs.length} files`);
  assert.ok(prose.includes('createStore'), 'and expected it to mention the API');
});

test('every public export is named somewhere in the documentation', async () => {
  const undocumented = [];
  const entries = [
    ...Object.entries(PACKAGES).map(([specifier, bundle]) => [specifier, bundle, null]),
    ...Object.entries(SOURCE_PACKAGES).map(([specifier, path]) => [specifier, null, path]),
  ];
  for (const [specifier, bundle, path] of entries) {
    if (bundle && isProduction && NO_PRODUCTION_BUILD.has(bundle)) continue;
    const module = await import(path ? new URL(path, import.meta.url).href : distUrl(bundle));
    for (const name of Object.keys(module)) {
      /** `default` is the module, not a name anyone writes. */
      if (name === 'default') continue;
      if (!new RegExp(`\\b${name.replace(/[$]/g, '\\$')}\\b`).test(prose)) undocumented.push(`${specifier} exports "${name}"`);
    }
  }
  assert.deepEqual(
    undocumented,
    [],
    `these are public API and appear in no .md or .txt in the repo:\n  ${undocumented.join('\n  ')}\n` +
      `Either document what they are for, or stop exporting them.`
  );
});
