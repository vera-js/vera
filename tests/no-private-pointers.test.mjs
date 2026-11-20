/**
 * **Public source names no private pointer** (R5, 2026-11-12). Source comments ship in every development bundle and in
 * the public repository, so a comment that points at private material, or at a label only a private tracker explains,
 * says nothing to its reader and something to a stranger: a register id (`D14b`, `R4`, `C10`), a session's name
 * (`vera-5a`), a private path (`.probe/`, `internal/`), a design-document name, or a tracker phrase ("Option (c)",
 * "PROBE (", "Step 2 ("). A comment states the fact instead; a ruling reads "Brian's ruling, <date>".
 *
 * Every package is held at zero. A term the pattern also matches that is the real word is allowed by EXACT occurrence
 * (file and text), never by pattern, so a new occurrence of it is still read before it is allowed. The comments come
 * from a full parse (`source-comments.mjs`), so code and strings are never read.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { comments } from './source-comments.mjs';
import { pointers } from './private-pointers.mjs';
import { packageFiles } from '../scripts/packages.mjs';

/**
 * File, then the exact comment line. Two kinds, each read before it was let in: the real words the pattern also matches
 * (Unicode's C0 and C1 control sets), and two pointers in packages the components machine does not change, each kept
 * only until the ledger entry that removes it lands. **An entry whose line is gone fails the suite**, so a fixed line
 * cannot leave a dead allowance behind to excuse the same text silently if it returns.
 */
const ALLOWED = new Set([
  /** The laptop's to remove (LAPTOP-LEDGER F8): an audit label in motion's source. */
  'packages/motion/src/url.ts| * This is the fix for audit S1. The old parser handed an attribute value',
  /** The laptop's to remove (LAPTOP-LEDGER F8): a register label in static's source. */
  'packages/static/src/render.ts|   * **Every value written must land** (2026-11-19, S4, the tier suites): the parser DROPS some markup outright — a',
  "packages/shared-utils/src/markup-grammar.ts| * matters: leading C0 controls and spaces are stripped, ASCII tab, LF and CR are removed anywhere, and",
  "packages/ssr/src/vera/escaping.ts| * URL Standard's parser reads a scheme: leading C0 controls and spaces stripped, ASCII tab, LF and CR",
  "packages/ssr/src/vera/escaping.ts| * The C1 numbers a parser reads as Windows-1252: `&#128;` is `€`, not U+0080. The HTML standard's table, by",
  "packages/ssr/src/vera/escaping.ts| * surrogate or an out-of-range value is U+FFFD, and 0x80–0x9F map through `C1`. `String.fromCodePoint` THROWS past",
]);

test('CONTROL: planted pointers are found, after a regex and a template too; code, strings and the real C0 are not', () => {
  const hard = 'const r = /a\\/b`/g;\nconst t = `x ${1 / 2} y`;\n/** decided in D14b, see .probe/x and vera-5a; Option (c) */\nconst b = 2;\n';
  assert.deepEqual(pointers(hard).map((p) => p.token), ['D14b', '.probe/', 'vera-5a', 'Option (c)']);
  const clean = "const D14b = 1;\nconst s = 'R4 vera-5a .probe/';\n/** Brian's ruling, 2026-11-11 */\nconst a = 1;\n";
  assert.deepEqual(pointers(clean), []);
});

test('CONTROL: every form the pattern gained is found, and its near-misses are not', () => {
  const planted = [
    ['ledger ids', '/** F1, S4 and M1 */', ['F1', 'S4', 'M1']],
    ['a session name with js', '/** asked vera-js-c1 */', ['vera-js-c1']],
    ['an attribution with a date', '/** the guard (d7, 2026-11-20) */', ['(d7, 2026-11-20)']],
    ["an attribution with 's", "/** the guard (d7's find) */", ["(d7's find)"]],
    ['an attribution wrapped across lines', '/**\n * the guard (d7,\n * 2026-11-20).\n */', ['(d7,\n * 2026-11-20)']],
    ["a long session name with 's", "/** the guard (vera-js-73's find) */", ["(vera-js-73's find)"]],
  ];
  for (const [what, comment, tokens] of planted)
    assert.deepEqual(pointers(`${comment}\nconst a = 1;\n`).map((p) => p.token), tokens, what);
  const near = "/** vera-js/vera, F12-2, S4.1, (be's way), (ab, 2026-11-20), (Brian, 2026-11-20) */\nconst a = 1;\n";
  assert.deepEqual(pointers(near).map((p) => p.token), [], 'the repository slug, a range, a decimal, a word, no digit, a person');
});

/** Every package source file's pointers against `allowed`: what is not allowed, and what is allowed but no longer there. */
const scan = (allowed) => {
  const hits = [];
  const used = new Set();
  const files = packageFiles('src/**/*.ts');
  let read = 0;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    read += comments(text).length;
    for (const p of pointers(text)) {
      const key = `${file}|${p.text}`;
      if (allowed.has(key)) used.add(key);
      else hits.push(`${file}:${p.line} [${p.token}] ${p.text.trim().slice(0, 110)}`);
    }
  }
  return { hits, stale: [...allowed].filter((key) => !used.has(key)), files: files.length, read };
};

test('no package source comment holds a private pointer, and every allowance is still needed', () => {
  const { hits, stale, files, read } = scan(ALLOWED);
  /** The floor: an empty walk would pass an empty list. Every package's sources and thousands of comments are read. */
  assert.ok(files > 100 && read > 2000, `the scan read ${files} files and ${read} comments: the walk is broken, not the source`);
  assert.deepEqual(hits, [], `state the fact instead of the label:\n  ${hits.join('\n  ')}`);
  assert.deepEqual(stale, [], 'an allowance whose line is gone: remove it, so the same text is read again if it returns');
});

test('CONTROL: an allowance for a line that does not exist is reported stale', () => {
  const planted = 'packages/core/src/index.ts| * a line no file holds (S9)';
  assert.deepEqual(scan(new Set([...ALLOWED, planted])).stale, [planted]);
});
