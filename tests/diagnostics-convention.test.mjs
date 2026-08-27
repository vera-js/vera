/**
 * Every diagnostic the framework prints is findable.
 *
 * A user filtering their console needs one string that finds all of them, and the framework had
 * four conventions: `[vera]`, `[vera-jsx]`, `autoloader:`, `@verajs/renderer/spread:` — and one
 * message, the autoloader's load failure, with **no prefix at all**. "Failed to load custom element
 * x-widget from …" gives no indication which library said it.
 *
 * The rule, asserted here rather than remembered:
 *
 * - anything reaching `console.warn` or `console.error` starts `[vera]`
 * - a thrown `Error` may name its function instead, because a stack already names the source — but
 *   if the message is *also* printed to the console by the framework, it carries the prefix too
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { walkFiles, readIfPresent } from './walk.mjs';

const root = new URL('../packages', import.meta.url).pathname;
const sources = [];
sources.push(
  ...walkFiles(root, /\.(ts|js)$/, { ignore: ['node_modules', 'dist'] }).filter((file) => !file.endsWith('.d.ts'))
);

/**
 * The call and its first template literal, which is where a prefix would be. Multi-line calls are
 * the norm here, so this reads forward to the first backtick or quote rather than one line.
 */
const CONSOLE_CALL = /console\.(warn|error)\(\s*(?:`([^`]*)|'([^']*)|"([^"]*))/g;

test('every console.warn and console.error is prefixed [vera]', () => {
  assert.ok(sources.length > 15, `expected to find the sources, found ${sources.length}`);
  const problems = [];
  for (const file of sources) {
    const text = readIfPresent(file);
    /** Gone between the walk and the read. */
    if (text === null) continue;
    for (const match of text.matchAll(CONSOLE_CALL)) {
      const message = match[2] ?? match[3] ?? match[4] ?? '';
      /**
       * `reportHookError` forwards a user's own error object rather than a message of ours, and
       * prefixing someone else's Error would misattribute it.
       */
      if (message === '' && /console\.error\(error\)/.test(match[0] + text.slice(match.index, match.index + 24)))
        continue;
      if (!message.startsWith('[vera]'))
        problems.push(`${relative(root, file)}: ${JSON.stringify(message.slice(0, 60))}`);
    }
  }
  assert.deepEqual(problems, [], `diagnostics a user cannot filter for:\n  ${problems.join('\n  ')}`);
});

/** And the prefix has to survive into the shipped bundles, or it only exists in source. */
test('the prefix reaches the built artifacts', () => {
  for (const bundle of [
    'packages/core/dist/development/vera.js',
    'packages/renderer/dist/development/vera-renderer-spread.js',
    'packages/autoloader/dist/development/vera-autoloader.js',
  ]) {
    const text = readFileSync(new URL(`../${bundle}`, import.meta.url).pathname, 'utf8');
    assert.match(text, /\[vera\]/, `${bundle} carries no [vera] diagnostic`);
  }
});
