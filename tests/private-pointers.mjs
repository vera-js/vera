/**
 * **What a private pointer looks like in a comment** (R5's rule, `no-private-pointers.test.mjs`): one pattern and one
 * reader, shared by that suite (every package's source) and `new-package-output.test.mjs` (what the scaffold writes), so
 * the two can never disagree about what counts.
 *
 * The forms, each with a planted control in `no-private-pointers.test.mjs`:
 * - a register or ledger id: `D14b`, `R4`, `C10`, `F1`, `S4`, `M1`; a dotted or ranged number (`F12-2`, `S4.1`) is not one;
 * - a session's name: `vera-5a`, `vera-js-c1`, but never the repository slug `vera-js/vera`;
 * - an attribution to a session: `(d7, 2026-11-20)`, `(d7's find)`, `(vera-js-73's find)`; the short name must hold a
 *   digit, so a parenthesized word (`(be's way)`) is not one;
 * - a private path (`.probe/`, `internal/`), a design document's name (`DESIGN-…`), or a tracker phrase (`Option (c)`,
 *   `PROBE (`, `Step 2 (`);
 * - an audit run's code: `arc-2 run 3`, `run-26`, `(run 25)`.
 */
import { comments } from './source-comments.mjs';

/** Every form above, in one global pattern. */
export const POINTER = new RegExp(
  [
    String.raw`\b[BCDFGMQRST]\d{1,2}[a-z]?\b(?![-.]\d)`,
    String.raw`\bvera-[0-9a-f]{2}\b`,
    String.raw`\bvera-js-[0-9a-z]{2,}\b`,
    /** The gaps allow a wrapped comment's line break and its ` * `: `(d7,` on one line and `2026-11-20)` on the next. */
    String.raw`\((?:(?=[0-9a-f]*\d)[0-9a-f]{2}|vera-(?:js-)?[0-9a-z]{2,})(?:'s\s+(?:\*\s+)?[a-z]+(?:,\s+(?:\*\s+)?20\d\d-\d\d-\d\d)?|,\s+(?:\*\s+)?20\d\d-\d\d-\d\d)\)`,
    String.raw`\.probe\/`,
    String.raw`\binternal\/`,
    String.raw`\bDESIGN-[A-Z]`,
    String.raw`\bOption \([a-z]\)`,
    String.raw`\bPROBE \(`,
    String.raw`\bStep \d+ \(`,
    /** An audit run's code: `arc-2 run 3`, `the run-26 probe`, `(run 25)`. */
    String.raw`\barc-\d+(?: run \d+)?\b`,
    String.raw`\brun-\d+\b`,
    String.raw`\(run \d+\)`,
  ].join('|'),
  'g'
);

/**
 * Each pointer in `text`'s comments: its line and that line's text. The comments come from a full parse, so code and
 * strings are never read.
 *
 * @param {string} text A source file's text
 * @return {{ line: number, token: string, text: string }[]} One entry per pointer, in order
 */
export const pointers = (text) => {
  const lines = text.split('\n');
  const found = [];
  for (const c of comments(text))
    for (const m of c.text.matchAll(POINTER)) {
      const line = text.slice(0, c.pos + m.index).split('\n').length;
      found.push({ line, token: m[0], text: lines[line - 1] });
    }
  return found;
};
