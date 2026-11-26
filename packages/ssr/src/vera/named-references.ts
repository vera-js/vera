/**
 * **`@verajs/ssr/named-references`: every named character reference of the HTML Standard, for the server DOM.**
 *
 * ```js
 * import { wire } from '@verajs/core';
 * import { namedReferences } from '@verajs/ssr/named-references';
 * wire([namedReferences]);
 * ```
 *
 * The server's parser decodes six names itself (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`, `&nbsp;`) and every
 * numeric reference; any other name reads back as written in a parsed node's `textContent`, attributes and `.value`,
 * while a browser decodes it. Wired, the parser hands this module every other name, and it answers by the tokenizer's
 * rules. Its own module, wired rather than built in, because the table is 2,231 entries: a server that never parses
 * `&copy;` never loads it. Wire it before the first render: a template's static text is decoded once, when the
 * template is first compiled, so a template rendered before the wire keeps such a name as written.
 */
import type { ReferenceInsert } from '@verajs/core';
import { ENTITIES, LONGEST_ENTITY } from './entities.js';

/** A code point written in hex. */
const hexCode = (hex: string): number => parseInt(hex, 16);

/**
 * The table, from name (`;` included where the standard lists it) to text. Built when this module loads, since a
 * server that imports it is one that reads these names; `entities.ts` holds only the string, because the literal in a
 * module that also holds functions doubled garbage collection during a process's first renders (measured, Node,
 * 2026-11-25).
 */
const TABLE = new Map<string, string>();
for (const entry of ENTITIES.split(',')) {
  const at = entry.indexOf(':');
  TABLE.set(entry.slice(0, at), String.fromCodePoint(...entry.slice(at + 1).split('.').map(hexCode)));
}

/** A–Z, a–z or 0–9. */
const alphanumeric = (code: number): boolean => (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);

/**
 * A named reference read as the HTML tokenizer reads it: the LONGEST name in the table that the run begins with, and
 * the rest of the run stays text (`&notin` in text is `¬in`, since only `not` is a name without `;`). In an attribute
 * value, a name matched without its `;` and followed by `=` or a letter or digit is not a reference at all (`&ampx=1`
 * stays as written), so a query string survives. `after` is the code after the run in the source.
 */
const read: ReferenceInsert = (run, attribute, after) => {
  for (let end = Math.min(run.length, LONGEST_ENTITY); end > 0; end--) {
    const text = TABLE.get(run.slice(0, end));
    if (text === undefined) continue;
    if (attribute && run.charCodeAt(end - 1) !== 59) {
      const next = end < run.length ? run.charCodeAt(end) : after;
      if (next === 61 || alphanumeric(next)) return `&${run}`;
    }
    return text + run.slice(end);
  }
  return `&${run}`;
};

/** The module to wire: no options, so a bare descriptor. */
export const namedReferences = { name: '@verajs/ssr/named-references', on: 'reference' as const, fn: read, priority: 50 };
