/**
 * Development, production, and the declarations — three descriptions of one entry, required to agree.
 *
 * `package.json` resolves `exports.development` to `dist/development/*.js`, `exports.default` to
 * `dist/*.min.js`, and `exports.types` to a **single** `.d.ts` describing both. Production is a
 * different program: `__DEV__` folds to `false` and its branches are deleted, properties are mangled,
 * workspace dependencies are inlined.
 *
 * ## The boundary this sits on
 *
 * `tests/consumer/*.ts` compiles against the declarations and **never runs**. Every other suite runs
 * against **one artifact at a time** and never reads a declaration. So nothing asks whether the three
 * agree — and an export present in development but folded out of production would leave the
 * declarations wrong for exactly the people who install the package, with every check still green.
 *
 * That is pass 87's shape: *a boundary shared by two guards belongs to neither.* Here it is shared by
 * three.
 *
 * ## Re-exports carry types without a local declaration
 *
 * Core's `inserts` and `wire` come from `@verajs/inserts` through `export * from` and
 * `export { … } from`, so no `declare const` mentions them and they are typed regardless. Counting
 * only local declarations reports those two as missing, which is why the check below accepts a name
 * appearing in **either** form — the question is whether a consumer gets a type, not where it is
 * written.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event',
  'CustomEvent', 'MouseEvent', 'location', 'history', 'MutationObserver', 'ShadowRoot', 'NodeFilter',
])
  globalThis[key] = dom.window[key];

/** `[name, development, production, declarations]`, relative to the repository root. */
const ENTRIES = [
  ['core', 'core/dist/development/vera.js', 'core/dist/vera.min.js', 'core/dist/development/vera.d.ts'],
  ['renderer', 'renderer/dist/development/vera-renderer.js', 'renderer/dist/vera-renderer.min.js', 'renderer/dist/development/vera-renderer.d.ts'],
  ['renderer/keyed', 'renderer/dist/development/vera-renderer-keyed.js', 'renderer/dist/vera-renderer-keyed.min.js', 'renderer/dist/development/vera-renderer-keyed.d.ts'],
  ['renderer/spread', 'renderer/dist/development/vera-renderer-spread.js', 'renderer/dist/vera-renderer-spread.min.js', 'renderer/dist/development/vera-renderer-spread.d.ts'],
  ['renderer/tag', 'renderer/dist/development/vera-renderer-tag.js', 'renderer/dist/vera-renderer-tag.min.js', 'renderer/dist/development/vera-renderer-tag.d.ts'],
  ['renderer/hydrate', 'renderer/dist/development/vera-renderer-hydrate.js', 'renderer/dist/vera-renderer-hydrate.min.js', 'renderer/dist/development/vera-renderer-hydrate.d.ts'],
  ['router', 'router/dist/development/vera-router.js', 'router/dist/vera-router.min.js', 'router/dist/development/vera-router.d.ts'],
  ['autoloader', 'autoloader/dist/development/vera-autoloader.js', 'autoloader/dist/vera-autoloader.min.js', 'autoloader/dist/development/vera-autoloader.d.ts'],
  ['inserts', 'inserts/dist/development/vera-inserts.js', 'inserts/dist/vera-inserts.min.js', 'inserts/dist/development/vera-inserts.d.ts'],
  ['reactivity', 'reactivity/dist/development/vera-reactivity.js', 'reactivity/dist/vera-reactivity.min.js', 'reactivity/dist/development/vera-reactivity.d.ts'],
  ['reactivity/collections', 'reactivity/dist/development/vera-reactivity-collections.js', 'reactivity/dist/vera-reactivity-collections.min.js', 'reactivity/dist/development/vera-reactivity-collections.d.ts'],
  ['styles', 'styles/dist/development/vera-styles.js', 'styles/dist/vera-styles.min.js', 'styles/dist/development/vera-styles.d.ts'],
];

const at = (path) => new URL(`../packages/${path}`, import.meta.url);

/** Names a consumer gets a type for — locally declared, or re-exported by name, or by `export *`. */
const typedNames = (text) => {
  const local = new Set([...text.matchAll(/^(?:export )?declare (?:const|function|let|var|class) (\w+)/gm)].map((m) => m[1]));
  const named = new Set();
  for (const match of text.matchAll(/^export \{([^}]*)\}/gm))
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) named.add(name);
    }
  return { local, named, hasStarReexport: /^export \* from/m.test(text) };
};

const loaded = await Promise.all(
  ENTRIES.map(async ([name, development, production, declarations]) => ({
    name,
    development: Object.keys(await import(at(development).href)),
    production: Object.keys(await import(at(production).href)),
    declarations: readFileSync(at(declarations), 'utf8'),
  }))
);

test('every entry exports the same names in development and in production', () => {
  assert.equal(loaded.length, ENTRIES.length, 'an entry failed to load');
  const problems = [];

  for (const entry of loaded) {
    const development = new Set(entry.development);
    const production = new Set(entry.production);
    const onlyDevelopment = [...development].filter((name) => !production.has(name));
    const onlyProduction = [...production].filter((name) => !development.has(name));

    if (onlyDevelopment.length)
      problems.push(`${entry.name}: in development only — ${onlyDevelopment.join(', ')}. Production is a different program; an export folded out of it is missing for everyone who installs the package.`);
    if (onlyProduction.length) problems.push(`${entry.name}: in production only — ${onlyProduction.join(', ')}`);
  }

  assert.deepEqual(problems, [], `the two builds disagree about what they export:\n  ${problems.join('\n  ')}`);
});

test('and the declarations cover what the production build actually exports', () => {
  const problems = [];

  for (const entry of loaded) {
    const { local, named, hasStarReexport } = typedNames(entry.declarations);
    /** `export *` forwards an unknown set, so a name it might carry cannot be called untyped. */
    if (hasStarReexport) continue;
    const untyped = entry.production.filter((name) => !local.has(name) && !named.has(name));
    if (untyped.length)
      problems.push(`${entry.name}: exported at runtime with no declaration — ${untyped.join(', ')}`);
  }

  assert.deepEqual(problems, [], `a TypeScript consumer cannot see these:\n  ${problems.join('\n  ')}`);
});
