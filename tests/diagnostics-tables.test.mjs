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
import { TABLES, codeOf, proseOf } from '../scripts/diagnostic-tables.mjs';

const at = (name, file) => new URL(`../packages/${name}/${file}`, import.meta.url);

/**
 * A converted call: `diagnostic(…, 'code', __DEV__ && PROSE['code']…` — or `SHARED.codeName(…` for a code more than one
 * package prints (shared-utils' table, one export per code, the name IS the code). Captures the printed code and the
 * explaining one, from either table. `coded(…)` is the jsx compiler's, whose message leads with a source position
 * rather than an area — the same `__DEV__ &&` form.
 */
const CALL = /(?:\b(?:diagnostic|misuse|coded))\([^;]*?'([a-z][a-z0-9-]*)',\s*__DEV__ && (?:PROSE\['([a-z][a-z0-9-]*)'\]|SHARED\.([a-zA-Z0-9]+))/g;

/** A package's tables merged, as `sync-diagnostics` publishes them — a code in two of them is a failure here too. */
const merged = async ({ name, tables }) => {
  const all = {};
  for (const table of tables)
    for (const [code, prose] of Object.entries(proseOf(await import(at(name, table).href)))) {
      assert.ok(!(code in all), `${name}: "${code}" is in two of its tables`);
      all[code] = prose;
    }
  return all;
};

const SHARED = await merged(TABLES.find(({ name }) => name === 'shared-utils'));
const raisedShared = new Set();
const results = [];
for (const entry of TABLES) {
  const own = entry.name === 'shared-utils' ? SHARED : await merged(entry);
  const raised = new Set();
  const problems = [];
  for (const file of entry.sources) {
    const text = readFileSync(at(entry.name, file), 'utf8');
    for (const [, printed, own, shared] of text.matchAll(CALL)) {
      const explained = own ?? codeOf(shared);
      if (printed !== explained) problems.push(`${file}: one call prints "${printed}" and explains "${explained}"`);
      if (shared !== undefined) {
        if (!(explained in SHARED)) problems.push(`${file}: SHARED.${shared} is not in shared-utils' table`);
        raisedShared.add(explained);
      } else raised.add(printed);
    }
  }
  results.push({ ...entry, own, raised, problems });
}

for (const { name, own, raised, problems, sources, checkedBy } of results)
  test(`${name}: every code raised has an entry, every entry is raised, and each call names one code`, { skip: checkedBy && `held by ${checkedBy}` }, () => {
    assert.deepEqual(problems, []);
    /** Shared-utils' entries are raised from OTHER packages' sources — checked by the next test. */
    if (name === 'shared-utils') return;
    assert.ok(sources.length === 0 || raised.size > 0, `CONTROL: ${name}'s sources raise codes the pattern can read`);
    assert.deepEqual([...raised].sort(), Object.keys(own).sort());
  });

test('every shared code is raised by some package, and only shared codes are raised as SHARED', () => {
  assert.ok(Object.keys(SHARED).length > 0, 'CONTROL: the shared table has entries');
  assert.deepEqual([...raisedShared].sort(), Object.keys(SHARED).sort());
});

test('CONTROL: the list names at least one package, so the loop above ran', () => {
  assert.ok(TABLES.length > 0);
});
