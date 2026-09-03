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

/** The renderer builds two `TreeWalker`s at import time, so it needs a DOM before it is loaded. */
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment'])
  globalThis[key] = dom.window[key];

/** Bare specifier -> the bundle name `tests/dist.mjs` resolves. */
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
  '@verajs/reactivity/collections': 'reactivity/collections',
  '@verajs/inserts': 'inserts',
  '@verajs/reactivity': 'reactivity',
  '@verajs/reactivity/computed': 'reactivity/computed',
  /** Build-time, so `dist.mjs` resolves it to its source under both conditions — see `UNBUILT` there. */
  '@verajs/jsx': 'jsx',
  /** Unpublished (`private: true`) like motion below, and held to the same bar for the same reason. */
  /** Unpublished (`private: true`) like cms and motion, and held to the same bar. */
  '@verajs/hooks': 'hooks',
  '@verajs/ui': 'ui',
  '@verajs/ui/elements': 'ui/elements',
  '@verajs/cms/content': 'cms/content',
  '@verajs/cms/publish': 'cms/publish',
  /**
   * Unpublished (`private: true` until its audits land), but its README is in this repository and
   * a reader will act on it — so its documented imports are held to the same bar. Import-safe
   * outside a browser by its own audit rule 9, which is why loading the bundles here just works.
   */
  '@verajs/motion': 'motion',
  '@verajs/motion/scroll-to': 'motion/scroll-to',
  '@verajs/motion/paint': 'motion/paint',
  '@verajs/motion/path': 'motion/path',
  '@verajs/motion/easings': 'motion/easings',
  '@verajs/motion/sequence': 'motion/sequence',
  '@verajs/motion/split': 'motion/split',
  '@verajs/motion/vera': 'motion/vera',
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
exportsOf['@verajs/ssr'] = await import('../packages/ssr/src/vera/index.js');

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
walk(new URL('..', import.meta.url).pathname);

test('every documented @verajs import names a real export', () => {
  assert.ok(docs.length > 10, `expected to find the docs, found ${docs.length}`);
  const problems = [];
  for (const file of docs) {
    const text = readFileSync(file, 'utf8');
    for (const [, names, specifier] of text.matchAll(/import \{([^}]+)\} from '(@verajs\/[^']+)'/g)) {
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
