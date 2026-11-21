/**
 * Every `import { … } from '@verajs/…'` in the documentation must name something the package
 * actually exports.
 *
 * This is the gap the 2026-08-25 audit found the hard way. `tests/docs-recipes.test.mjs` executes
 * blocks marked `<!-- recipe -->`, which is a strong check on the blocks that carry the marker and
 * no check at all on the prose around them — and prose is where the API names live. When `insert`
 * became `wire` and `setRenderer` was removed, the code changed and 23 references did not; the
 * suite stayed green throughout, because none of them were recipes.
 *
 * Every doc file is discovered rather than listed, so a new one is covered the day it is written.
 * Names are checked against the **built artifacts**, so this fails on a rename the moment the
 * package is rebuilt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { distUrl, isProduction, NO_PRODUCTION_BUILD } from './dist.mjs';
import { fsPath } from '../scripts/fs-path.mjs';

/** The renderer builds two `TreeWalker`s at import time, so it needs a DOM before it is loaded. */
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment'])
  globalThis[key] = dom.window[key];

/** Bare specifier -> the bundle name `tests/dist.mjs` resolves. */
const PACKAGES = {
  '@vera-hooks/light-dismiss': 'vera-hooks/light-dismiss',
  '@vera-hooks/listbox': 'vera-hooks/listbox',
  '@vera-hooks/labeled': 'vera-hooks/labeled',
  '@vera-hooks/roving-focus': 'vera-hooks/roving-focus',
  '@vera-hooks/announce': 'vera-hooks/announce',
  '@vera-hooks/anchor': 'vera-hooks/anchor',
  '@vera-components/field': 'vera-components/field',
  '@vera-components/icon': 'vera-components/icon',
  '@vera-components/kbd': 'vera-components/kbd',
  '@vera-components/kbd/element': 'vera-components/kbd/element',
  '@vera-components/spinner': 'vera-components/spinner',
  '@verajs/core': 'core',
  '@verajs/lite': 'lite',
  '@verajs/static': 'static',
  '@verajs/renderer': 'renderer',
  '@verajs/renderer/keyed': 'renderer/keyed',
  '@verajs/renderer/native-elements': 'renderer/native-elements',
  '@verajs/renderer/multi-window': 'renderer/multi-window',
  '@verajs/renderer/until': 'renderer/until',
  '@verajs/renderer/slots': 'renderer/slots',
  '@verajs/renderer/namespaces': 'renderer/namespaces',
  '@verajs/renderer/elements': 'renderer/elements',
  '@verajs/renderer/portal': 'renderer/portal',
  '@verajs/renderer/spread': 'renderer/spread',
  '@verajs/renderer/hydration': 'renderer/hydration',
  '@verajs/renderer/hydrate-slots': 'renderer/hydrate-slots',
  '@verajs/renderer/tag': 'renderer/tag',
  '@verajs/renderer/profiler': 'renderer/profiler',
  '@verajs/router': 'router',
  '@verajs/autoloader': 'autoloader',
  '@verajs/styles': 'styles',
  '@verajs/store/collections': 'store/collections',
  '@verajs/inserts': 'inserts',
  '@verajs/store': 'store',
  '@verajs/store/resource': 'store/resource',
  /** Build-time, so `dist.mjs` resolves it to its source under both conditions — see `UNBUILT` there. */
  '@verajs/jsx': 'jsx',
  '@verajs/jsx/standalone': 'jsx/standalone',
  /** Unpublished (`private: true`) like cms below, and held to the same bar for the same reason. */
  /** Unpublished (`private: true` until its audits land), but its READMEs and the autoloader's
   *  lazy-directive recipe are in this repository and a reader will act on them. */
  '@verajs/directives': 'directives',
  '@verajs/hot': 'hot',
  '@verajs/hot/vite': 'hot/vite',
  '@vera-components/select': 'vera-components/select',
  '@vera-components/select/elements': 'vera-components/select/elements',
  '@verajs/cms/content': 'cms/content',
  '@verajs/cms/publish': 'cms/publish',
};

/** Packages resolved from source rather than a bundle — see below. */
const SOURCE_PACKAGES = ['@verajs/eslint-config', '@verajs/ssr'];

const exportsOf = {};
for (const [specifier, bundle] of Object.entries(PACKAGES)) {
  if (isProduction && NO_PRODUCTION_BUILD.has(bundle)) continue;
  exportsOf[specifier] = await import(distUrl(bundle));
}

/**
 * The two packages with no `dist` to resolve. `@verajs/ssr` publishes its source directly and
 * `@verajs/eslint-config` is a config module; both are imported from source for the same reason the
 * others are imported from `dist` — the names have to come from the artifact, not from a list here.
 *
 * `ssr` goes **last** on purpose: it installs DOM globals over the jsdom ones above, which every
 * other module in this file has already finished reading.
 */
exportsOf['@verajs/eslint-config'] = await import('../packages/eslint-config/index.js');
exportsOf['@verajs/ssr'] = await import('../packages/ssr/dist/vera/index.js');

/** Markdown and text docs, minus changelogs — those describe releases, not the current API. */
const docs = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    /**
     * `internal/` is a **different repository** cloned into this tree (see CLAUDE.md), so its docs
     * are not this repo's contract and its prose discusses APIs across versions.
     */
    if (entry === 'node_modules' || entry === 'dist' || entry === 'internal' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(md|txt)$/.test(entry) && !/CHANGELOG/i.test(entry)) docs.push(full);
  }
};
walk(fsPath(new URL('..', import.meta.url)));

test('every documented @verajs import names a real export', () => {
  assert.ok(docs.length > 10, `expected to find the docs, found ${docs.length}`);
  const problems = [];
  for (const file of docs) {
    const text = readFileSync(file, 'utf8');
    /** A bare `import '…'` (a component's registering entry) names no export, but its package must exist. */
    for (const [, specifier] of text.matchAll(/import '(@(?:verajs|vera-components|vera-hooks)\/[^']+)'/g))
      if (!exportsOf[specifier] && !(specifier in PACKAGES) && !SOURCE_PACKAGES.includes(specifier))
        problems.push(`${file}: no such package "${specifier}"`);
    /** The three scopes: the framework's, and the components' and hooks' (2026-11-21). */
    for (const [, names, specifier] of text.matchAll(/import \{([^}]+)\} from '(@(?:verajs|vera-components|vera-hooks)\/[^']+)'/g)) {
      const module = exportsOf[specifier];
      /** An unknown specifier is itself a finding — a documented package that does not exist. */
      if (!module) {
        if (!(specifier in PACKAGES) && !SOURCE_PACKAGES.includes(specifier))
          problems.push(`${file}: no such package "${specifier}"`);
        continue;
      }
      for (const raw of names.split(',')) {
        const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0];
        /** A type-only export is erased from the bundle, so only value names are checkable. */
        if (name && !(name in module) && !/^[A-Z]/.test(name))
          problems.push(`${file}: ${specifier} has no export "${name}"`);
      }
    }
  }
  assert.deepEqual(problems, [], `documentation names APIs that do not exist:\n  ${problems.join('\n  ')}`);
});
