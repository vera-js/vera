/**
 * **Every package's diagnostics table is a manifest** — the generalization of `diagnostics-table.test.mjs` (directives)
 * to every package listed in `scripts/diagnostic-tables.mjs`, the one list the docs generator also reads.
 *
 * Per package, both directions: every code its sources raise has a table entry, and every entry is raised — an orphan
 * entry is a docs page for nothing, a missing one a production link to nothing. And each call names its code ONCE in
 * spirit: `diagnostic(area, subject, 'x', __DEV__ && PROSE['x'](…))` must carry the same code in both places, so a typo
 * in one cannot print one page's link beside another page's sentence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TABLES } from '../scripts/diagnostic-tables.mjs';

const at = (name, file) => new URL(`../packages/${name}/${file}`, import.meta.url);

/** A converted call: `diagnostic(…, 'code', __DEV__ && PROSE['code']…`. Captures the two spellings of the code. */
const CALL = /diagnostic\([^;]*?'([a-z][a-z0-9-]*)',\s*__DEV__ && PROSE\['([a-z][a-z0-9-]*)'\]/g;

for (const { name, table, sources } of TABLES)
  test(`${name}: every code raised has an entry, every entry is raised, and each call names one code`, async () => {
    const { PROSE } = await import(at(name, table).href);
    const raised = new Set();
    for (const file of sources) {
      const text = readFileSync(at(name, file), 'utf8');
      for (const [, printed, explained] of text.matchAll(CALL)) {
        assert.equal(printed, explained, `${file}: one call prints "${printed}" and explains "${explained}"`);
        raised.add(printed);
      }
    }
    assert.ok(raised.size > 0, `CONTROL: ${name}'s sources raise codes the pattern can read`);
    assert.deepEqual([...raised].sort(), Object.keys(PROSE).sort());
  });

test('CONTROL: the list names at least one package, so the loop above ran', () => {
  assert.ok(TABLES.length > 0);
});
