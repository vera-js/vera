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

/** Every call, whether or not the pattern above can read its first argument. */
const ANY_CONSOLE_CALL = /console\.(warn|error)\(/g;

/**
 * **Calls whose first argument is not a literal, so `CONSOLE_CALL` cannot read them.**
 *
 * The header above claims *anything* reaching `console.warn` or `console.error` starts `[vera]`, and
 * the pattern only ever verified the calls it could parse. Four could not be, and a fifth added
 * tomorrow would have been unverified in silence — a guard that is complete about what it can see and
 * says nothing about the rest.
 *
 * So the set is now closed: every call is either parsed, or listed here with the reason, or fails.
 * Three of these forward **someone else's error object**, where a prefix would misattribute it. The
 * fourth is a ternary between two messages, and its branches are checked below rather than excused —
 * an unprefixed branch added later is exactly what this file exists to catch.
 */
const NOT_A_LITERAL = new Map([
  ['autoloader/src/autoloader.ts', "forwards a caught error's own message"],
  ['core/src/hooks/reportHookError.ts', "forwards a user's own error object"],
  ['core/src/modules/createHook.ts', "forwards a user's own error object"],
  ['ssr/src/vera/shim.js', "forwards a caught error object"],
  ['router/src/services.ts', 'a ternary between two messages — both branches are checked below'],
]);

/**
 * The balanced argument text of a call, so a ternary's branches can be read. Counts parentheses
 * rather than matching to the first `)`, since every message here contains them.
 */
const argumentsOf = (text, start) => {
  let depth = 0;
  for (let index = text.indexOf('(', start); index < text.length; index++) {
    if (text[index] === '(') depth++;
    else if (text[index] === ')' && --depth === 0) return text.slice(text.indexOf('(', start) + 1, index);
  }
  return '';
};

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

/**
 * **And every call the pattern above could not read is accounted for.**
 *
 * Without this the guard verifies what it happens to parse and is silent about the rest, which is how
 * a ternary between two messages sat unchecked: `CONSOLE_CALL` needs a literal immediately after the
 * `(`, and an expression there makes the whole call invisible rather than failing.
 */
test('no console call escapes the check by not starting with a literal', () => {
  const unaccounted = [];
  const unprefixedBranches = [];

  for (const file of sources) {
    const text = readIfPresent(file);
    if (text === null) continue;
    const parsed = new Set([...text.matchAll(CONSOLE_CALL)].map((match) => match.index));
    const where = relative(root, file);

    for (const match of text.matchAll(ANY_CONSOLE_CALL)) {
      if (parsed.has(match.index)) continue;
      const reason = NOT_A_LITERAL.get(where);
      if (reason === undefined) {
        unaccounted.push(`${where}: ${text.slice(match.index, match.index + 60).split('\n')[0]}`);
        continue;
      }
      /**
       * A call that forwards an error carries no message of ours. One that holds messages must have
       * each **branch** prefixed — the half a ternary was getting for free.
       *
       * The template that *begins* a branch, not every template in the call: a long message is built
       * by concatenating fragments and only the first carries the prefix. Checking all of them
       * reported six continuations of one correct message as six failures.
       */
      if (!reason.includes('ternary')) continue;
      const args = argumentsOf(text, match.index);
      for (const [, message] of args.matchAll(/[?:]\s*`([^`]*)/g))
        if (!message.startsWith('[vera]'))
          unprefixedBranches.push(`${where}: ${JSON.stringify(message.slice(0, 60))}`);
    }
  }

  assert.deepEqual(
    unaccounted,
    [],
    `these console calls do not begin with a literal, so the prefix check cannot read them. Add each ` +
      `to NOT_A_LITERAL with the reason, or give it a literal first argument:\n  ${unaccounted.join('\n  ')}`
  );
  assert.deepEqual(
    unprefixedBranches,
    [],
    `a branch of a multi-message call is missing the prefix:\n  ${unprefixedBranches.join('\n  ')}`
  );
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
