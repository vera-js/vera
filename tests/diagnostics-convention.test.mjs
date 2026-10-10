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
import { walkFiles, readIfPresent as readRaw } from './walk.mjs';

/**
 * A `'%s'` first argument only stops the console from reading the message as a format string (a subject with `%c3` in
 * it garbled the line and swallowed the forwarded error — vera-5a, 2026-10-09). The message is the NEXT argument, so
 * the checks below read through it.
 */
const readIfPresent = (file) => readRaw(file)?.replace(/console\.(warn|error)\(\s*'%s',\s*/g, 'console.$1(');

const root = new URL('../packages', import.meta.url).pathname;

const sources = [];
sources.push(
  ...walkFiles(root, /\.(ts|js)$/, { ignore: ['node_modules', 'dist'] })
    .filter((file) => !file.endsWith('.d.ts'))
);

/**
 * The prefix a file's diagnostics must carry: `[vera]`, everywhere. (Retired `@verajs/motion`
 * carried its own `@verajs/motion:` prefix until the phase-4 fold-in; the ported motion pack in
 * `@verajs/directives` speaks `[vera]` like everything else, which closed that carve-out.)
 */
const PREFIX_OF = () => '[vera]';

/**
 * The call and its first template literal, which is where a prefix would be. Multi-line calls are
 * the norm here, so this reads forward to the first backtick or quote rather than one line.
 */
const CONSOLE_CALL = /console\.(warn|error)\(\s*(?:`([^`]*)|'([^']*)|"([^"]*))/g;

/** Every call, whether or not the pattern above can read its first argument. */
const ANY_CONSOLE_CALL = /console\.(warn|error)\(/g;

/**
 * **A call printing what the shared formatter built is prefixed by construction** — `diagnostic` (shared-utils) writes
 * `[vera]` itself, which the test below the next one reads from its source, so such a call is read here rather than
 * excused.
 */
const DIAGNOSTIC_CALL = /console\.(warn|error)\(\s*diagnostic\(/g;

/**
 * **Calls whose first argument is not a literal, so `CONSOLE_CALL` cannot read them.**
 *
 * The header above claims *anything* reaching `console.warn` or `console.error` starts `[vera]`, and
 * the pattern only ever verified the calls it could parse. Four could not be, and a fifth added
 * tomorrow would have been unverified in silence — a guard that is complete about what it can see and
 * says nothing about the rest.
 *
 * So the set is now closed: every call is either parsed, or listed here with the reason, or fails.
 * Two of these forward **someone else's error object**, where a prefix would misattribute it. (The router's ternary
 * between two messages left with the code-system migration, 2026-10-09: its two variants are one code now.) The
 * ternary branch check below stays, for the next one.
 */
const NOT_A_LITERAL = new Map([
  ['autoloader/src/autoloader.ts', [1, 'forwards a refusal of its own, already coded (loader-url-refused) — routing']],
  ['autoloader/src/loader.ts', [1, 'forwards a refusal of its own, already coded (directive-loader-name, loader-url-refused) — routing']],
  ['ssr/src/vera/shim.ts', [1, 'forwards a caught error object']],
  /** Hydration's once-per-kind helper: every caller hands it a `diagnostic(…)` line — asserted below. */
  ['renderer/src/hydration.ts', [2, 'prints a line diagnostic() built — every caller passes one']],
  /** Motion's one formatter, problemLine(): the fallback reporter prints it, and the server-written script prints
   *  the lines it built — every line starts `[vera]`, asserted below in both builds. */
  ['motion/src/schema.ts', [1, 'prints a line problemLine() built']],
  ['motion/src/ssr.ts', [1, "the server-written script prints problemLine()'s lines"]],
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
      if (!message.startsWith(PREFIX_OF(file)))
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
  /**
   * **The allowance is keyed by FILE, so it has to be counted.** An entry excuses every unreadable
   * call the file ever grows, not the one it was written for — and `router/src/services.ts` already
   * holds ten console calls, so an eleventh with a variable first argument would have slid through
   * unreviewed. Measured 2026-09-12: each listed file has exactly one, which is the only reason
   * this is a pin rather than a defect. Counting turns a second one into a deliberate edit.
   */
  const excused = new Map();

  for (const file of sources) {
    const text = readIfPresent(file);
    if (text === null) continue;
    const parsed = new Set([...text.matchAll(CONSOLE_CALL), ...text.matchAll(DIAGNOSTIC_CALL)].map((match) => match.index));
    const where = relative(root, file);

    for (const match of text.matchAll(ANY_CONSOLE_CALL)) {
      if (parsed.has(match.index)) continue;
      const entry = NOT_A_LITERAL.get(where);
      if (entry === undefined) {
        unaccounted.push(`${where}: ${text.slice(match.index, match.index + 60).split('\n')[0]}`);
        continue;
      }
      const [, reason] = entry;
      excused.set(where, (excused.get(where) ?? 0) + 1);
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

  /** Both directions: an entry that excuses more than it claims, and one that excuses nothing. */
  const miscounted = [];
  for (const [where, [expected, reason]] of NOT_A_LITERAL) {
    const found = excused.get(where) ?? 0;
    if (found !== expected)
      miscounted.push(
        `${where}: allows ${expected} unreadable call(s) (${reason}) but the file has ${found}. ` +
          (found > expected
            ? 'A new one is being excused without review — check it and raise the count deliberately.'
            : 'The entry no longer has a subject; delete it rather than leave it excusing a future call.')
      );
  }
  assert.deepEqual(miscounted, [], `\n  ${miscounted.join('\n  ')}`);
});

/**
 * **The shared formatter prefixes every line it builds** — which is what lets a `console.warn(diagnostic(…))` be read
 * as prefixed above. Both of its templates (production's link line, development's sentence) must begin `[vera]`.
 */
test('the shared diagnostic formatter prefixes both of its lines', () => {
  const text = readFileSync(new URL('../packages/shared-utils/src/diagnostic.ts', import.meta.url), 'utf8');
  const body = text.slice(text.indexOf('export const diagnostic'));
  const lines = [...body.matchAll(/[?:]\s*`([^`]*)/g)].map(([, line]) => line);
  assert.equal(lines.length, 2, 'CONTROL: the development and production templates were both found');
  for (const line of lines) assert.ok(line.startsWith('[vera] '), `a formatter line lacks the prefix: ${line.slice(0, 40)}`);
});

/** Motion's problemLine() — excused above for its two printers — builds only prefixed lines: `diagnostic()` in
 *  development (checked by the test before this one), and a `[vera] <code>` template in production. */
test("motion's problemLine prefixes both of its lines", () => {
  const text = readFileSync(new URL('../packages/motion/src/schema.ts', import.meta.url), 'utf8');
  const body = text.slice(text.indexOf('export const problemLine'), text.indexOf('let report'));
  assert.match(body, /\?\s*diagnostic\('motion', /, 'CONTROL: development builds its line with diagnostic()');
  const production = [...body.matchAll(/:\s*`([^`]*)/g)].map(([, line]) => line);
  assert.equal(production.length, 1, 'CONTROL: the production template was found');
  assert.ok(production[0].startsWith('[vera] '), `the production line lacks the prefix: ${production[0]}`);
});

/** And a local helper excused above for printing `diagnostic()` lines receives nothing else. */
test("hydration's warn helper is only ever handed a diagnostic() line", () => {
  const text = readFileSync(new URL('../packages/renderer/src/hydration.ts', import.meta.url), 'utf8');
  const calls = [...text.matchAll(/(?<![.\w])warn\(/g)].filter((m) => !text.slice(m.index - 20, m.index).includes('const '));
  const coded = calls.filter((m) => /^warn\([^,]+,\s*diagnostic\(/.test(text.slice(m.index, m.index + 200)));
  assert.ok(calls.length > 0, 'CONTROL: the helper is called');
  assert.equal(coded.length, calls.length, 'a warn() call passes something other than a diagnostic() line');
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

/**
 * **`console.warn` and `console.error`, and nothing else.**
 *
 * The rule above is about those two, and a diagnostic written with a third method escapes it twice
 * over. `console.info('[vera] …')` is not read by the prefix check, which only looks at those two
 * names — and it is not dropped by the production build, whose terser config is `drop_console:
 * ['log']` rather than `true`, deliberately, so that real failures survive minification.
 *
 * So it would ship, unchecked, and be invisible to the console filter this convention exists to give
 * a user. `console.debug` and `console.trace` are the same. `console.log` fails differently and is
 * arguably worse: it is *dropped* in production, so a diagnostic written with it works in development
 * and silently does not exist for the people who need it — the dev/prod divergence this audit already
 * has a defect for.
 *
 * The profiler's single `console.log` is the exception and is deliberate: that entry is built for
 * development only, and printing a report is what it is for.
 */
test('no diagnostic uses a console method outside warn and error', () => {
  const ALLOWED = new Set(['warn', 'error']);
  /** `[file, method]` pairs that are deliberate, each with the reason. */
  const EXCEPTIONS = new Map([['renderer/src/profiler.ts', 'log — a development-only entry printing its report']]);

  const found = [];
  for (const file of sources) {
    const text = readIfPresent(file);
    if (text === null) continue;
    const where = relative(root, file);
    for (const [, method] of text.matchAll(/console\.(\w+)\(/g)) {
      if (ALLOWED.has(method)) continue;
      if (EXCEPTIONS.get(where)?.startsWith(method)) continue;
      found.push(`${where}: console.${method}()`);
    }
  }

  assert.deepEqual(
    found,
    [],
    `a diagnostic here would be unfilterable and unchecked — the prefix rule reads only warn and ` +
      `error, and production drops only log:\n  ${found.join('\n  ')}`
  );
});
