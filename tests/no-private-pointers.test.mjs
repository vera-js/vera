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
import { globSync, readFileSync } from 'node:fs';
import { comments } from './source-comments.mjs';

const POINTER = /\b[BCDGQRT]\d{1,2}[a-z]?\b(?![-.]\d)|\bvera-[0-9a-f]{2}\b|\.probe\/|\binternal\/|\bDESIGN-[A-Z]|\bOption \([a-z]\)|\bPROBE \(|\bStep \d+ \(/g;
/** The real words the pattern also matches: Unicode's C0 and C1 control sets. File, then the exact comment line. */
const ALLOWED = new Set([
  "packages/shared-utils/src/markup-grammar.ts| * matters: leading C0 controls and spaces are stripped, ASCII tab, LF and CR are removed anywhere, and",
  "packages/ssr/src/vera/escaping.ts| * URL Standard's parser reads a scheme: leading C0 controls and spaces stripped, ASCII tab, LF and CR",
  "packages/ssr/src/vera/escaping.ts| * The C1 numbers a parser reads as Windows-1252: `&#128;` is `€`, not U+0080. The HTML standard's table, by",
  "packages/ssr/src/vera/escaping.ts| * surrogate or an out-of-range value is U+FFFD, and 0x80–0x9F map through `C1`. `String.fromCodePoint` THROWS past",
]);

/** Each pointer in `text`'s comments: its line and that line's text. */
const pointers = (text) => {
  const lines = text.split('\n');
  const found = [];
  for (const c of comments(text))
    for (const m of c.text.matchAll(POINTER)) {
      const line = text.slice(0, c.pos + m.index).split('\n').length;
      found.push({ line, token: m[0], text: lines[line - 1] });
    }
  return found;
};

test('CONTROL: planted pointers are found, after a regex and a template too; code, strings and the real C0 are not', () => {
  const hard = 'const r = /a\\/b`/g;\nconst t = `x ${1 / 2} y`;\n/** decided in D14b, see .probe/x and vera-5a; Option (c) */\nconst b = 2;\n';
  assert.deepEqual(pointers(hard).map((p) => p.token), ['D14b', '.probe/', 'vera-5a', 'Option (c)']);
  const clean = "const D14b = 1;\nconst s = 'R4 vera-5a .probe/';\n/** Brian's ruling, 2026-11-11 */\nconst a = 1;\n";
  assert.deepEqual(pointers(clean), []);
});

test('no package source comment holds a private pointer', () => {
  const hits = [];
  for (const file of globSync('packages/*/src/**/*.ts'))
    for (const p of pointers(readFileSync(file, 'utf8'))) {
      const key = `${file}|${p.text}`;
      if (ALLOWED.has(key)) continue;
      hits.push(`${file}:${p.line} [${p.token}] ${p.text.trim().slice(0, 110)}`);
    }
  assert.deepEqual(hits, [], `state the fact instead of the label:\n  ${hits.join('\n  ')}`);
});
