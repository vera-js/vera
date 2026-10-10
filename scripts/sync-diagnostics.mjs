/**
 * Generates `packages/directives/diagnostics.json` from the diagnostics table — every refusal the
 * package can record, as DATA — and the same file for every other package with a table (`TABLES`).
 *
 * Three consumers, one source. The development bundle renders these sentences into the console;
 * `verajs.dev/e/<code>` is a page per entry; and **Vera Studio** ships this file so its
 * inspector can show a full sentence for a rejection while running a PRODUCTION bundle, where the
 * prose has been folded away. Studio's user is the author, so "production" there is not the
 * end-user context that justifies dropping the words.
 *
 * Placeholders come from the entry functions' own parameter names — calling
 * `(key) => [\`"${key}" was not declared…\`]` with the string `{key}` yields
 * `"{key}" was not declared…`, so the published sentence documents its own interpolation without a
 * second format to keep in step.
 *
 * `--check` is what makes it trustworthy. A generated artifact that is committed drifts the moment
 * nothing verifies it, and this repo has been bitten exactly there before.
 *
 *   node scripts/sync-diagnostics.mjs           # write
 *   node scripts/sync-diagnostics.mjs --check   # fail if stale
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';

/**
 * **Package sources import each other as `./x.js`** (the TypeScript convention for what the build emits), and Node's
 * type-stripping runs `.ts` but never rewrites that specifier — so a source module with one runtime relative import
 * could not be read here at all (motion's `schema.ts` gained one, its diagnostics table, 2026-10-09). A missing
 * relative `.js` under `packages/` is retried as the `.ts` beside it; nothing else changes.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !/^\.{1,2}\/.*\.js$/.test(specifier) || !context.parentURL?.includes('/packages/')) throw error;
      return nextResolve(specifier.replace(/\.js$/, '.ts'), context);
    }
  },
});

const OUT = new URL('../packages/directives/diagnostics.json', import.meta.url);

/**
 * Imported straight from source rather than a bundle, and that is deliberate: `PROSE` must NOT be
 * re-exported from the package index, because a live export is a reference rollup cannot drop —
 * which would keep the whole table in the production bundle and undo the 1,035 B it exists to
 * recover. Node strips the type annotations; the module imports nothing.
 */
const { PROSE } = await import('../packages/directives/src/diagnostics.ts');
/** The same constant the production bundle prints, never a second copy of the string. */
const { DOCS } = await import('../packages/shared-utils/src/diagnostic.ts');
/**
 * The `$` vocabulary, from the same declaration the runtime registers. It was typed by hand into
 * `llms.txt` and the package README, so adding `$deltaY` for `wheel` would have meant editing three
 * places with nothing failing when someone edited one — the drift this file exists to prevent for
 * rejection codes, in a second list beside them.
 */
const { DEFAULT_PAYLOADS, TYPE } = await import('../packages/directives/src/payload-defaults.ts');

/** The parameter names, so a published sentence carries `{key}` where the console carries a value. */
const paramsOf = (fn) => {
  const source = fn.toString();
  const head = source.slice(source.indexOf('(') + 1, source.indexOf(')'));
  return head.split(',').map((p) => p.split(':')[0].trim().replace(/\?$/, '')).filter(Boolean);
};

/** A table as published entries — every package's the same way, so a docs page reads one shape. */
const entriesOf = (table) =>
  Object.keys(table).sort().map((code) => {
    const params = paramsOf(table[code]);
    const [message, fix] = table[code](...params.map((p) => `{${p}}`));
    return { code, params, message, ...(fix ? { fix } : {}) };
  });
const entries = entriesOf(PROSE);

/**
 * **Every other package with a diagnostics table** — listed once in `scripts/diagnostic-tables.mjs` — each writing its
 * own `diagnostics.json` beside its package.json. Directives' carries more than its codes (payloads, above), which is
 * why it is not in that list; its codes still join the uniqueness check below.
 */
const { TABLES: LISTED, proseOf } = await import('./diagnostic-tables.mjs');
const TABLES = [];
for (const { name, tables } of LISTED) {
  /** Several tables per package (one per bundle entry) merge into its one file; a code twice is caught below. */
  const tableEntries = [];
  for (const table of tables) tableEntries.push(...entriesOf(proseOf(await import(`../packages/${name}/${table}`))));
  TABLES.push({
    name,
    out: new URL(`../packages/${name}/diagnostics.json`, import.meta.url),
    entries: tableEntries,
    json: `${JSON.stringify({ url: DOCS, entries: tableEntries }, null, 2)}\n`,
  });
}

/** One page per code at one URL: a code two packages both raise would be one page describing two things. */
const owners = new Map(entries.map(({ code }) => [code, 'directives']));
for (const { name, entries: list } of TABLES)
  for (const { code } of list) {
    if (owners.has(code)) {
      console.error(`diagnostic code "${code}" is raised by both ${owners.get(code)} and ${name} — codes are one namespace.`);
      process.exit(1);
    }
    owners.set(code, name);
  }

/** Grouped by the vocabulary each set of bases shares, which is how a reader wants to see it —
 *  nine mouse bases offering the same three names is one fact, not nine. */
const byVocabulary = new Map();
for (const [base, payload] of Object.entries(DEFAULT_PAYLOADS)) {
  const vars = [...Object.keys(payload), ...Object.keys(TYPE)].map((one) => `$${one}`);
  const key = vars.join(' ');
  if (!byVocabulary.has(key)) byVocabulary.set(key, { vars, bases: [] });
  byVocabulary.get(key).bases.push(base);
}
const payloads = [
  { bases: ['*'], vars: Object.keys(TYPE).map((one) => `$${one}`) },
  ...[...byVocabulary.values()],
];

/**
 * The motion vocabulary as DATA — the lockstep artifact omni vendors and pins a test to. Schema-
 * derived like everything else in this file, so it cannot drift from the parser that enforces it;
 * function-valued fields are omitted because a conformance corpus pins grammar and observable
 * behavior, never implementation.
 */
const { PROPERTIES, SETTINGS } = await import('../packages/motion/src/schema.ts');
const { PRESETS } = await import('../packages/motion/src/presets.ts');
/** From the BUILT bundle: the pack modules carry runtime imports Node's type-stripper cannot
 *  follow from source (it strips types but never rewrites `./x.js` specifiers). The gate builds
 *  before it checks diagnostics, so the artifact is always fresher than this read. */
const { paintRows, pathRows, sequenceRows } =
  await import('../packages/directives/dist/development/vera-directives-motion.js');
const VOCAB_OUT = new URL('../packages/directives/motion-vocabulary.json', import.meta.url);

/**
 * `cssFunction`/`cssProperty` are INCLUDED on purpose, second thoughts overruled: which CSS a key
 * lands in (`opacity` → `filter: opacity()`) is observable surface a conforming generator must
 * reproduce — reading the `opacity` PROPERTY where the rule animates `filter` cost this repo a
 * day-long phantom WebKit hunt. Pack rows ride along flagged by `pack`, so a consumer can say
 * "pack not enabled" instead of "unknown property". Row-shaped pack entries only; insert hooks are
 * implementation.
 */
const packRow = (pack) => (row) => ({ pack, row });
const flat = (tree) => [tree].flat(Infinity).filter((one) => one && typeof one === 'object' && 'key' in one);
const packRows = [
  ...flat(paintRows).map(packRow('paint')),
  ...flat(pathRows).map(packRow('path')),
  ...flat(sequenceRows({})).map(packRow('sequence')),
];
const propertyJson = ({ key, category, cssFunction, cssProperty, defaultUnit, units, min, max, initial, discrete }, pack) =>
  ({ key, category, ...(cssFunction ? { cssFunction } : {}), ...(cssProperty ? { cssProperty } : {}),
     defaultUnit, units, ...(min !== undefined ? { min } : {}),
     ...(max !== undefined ? { max } : {}), initial, ...(discrete ? { discrete } : {}),
     ...(pack ? { pack } : {}) });
const vocabulary = {
  properties: [
    ...PROPERTIES.map((row) => propertyJson(row)),
    ...packRows.filter(({ row }) => 'category' in row).map(({ pack, row }) => propertyJson(row, pack)),
  ],
  settings: [
    ...SETTINGS.map(({ key, type, min, max, allowed }) =>
      ({ key, type, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}),
         ...(allowed ? { allowed } : {}) })),
    ...packRows.filter(({ row }) => 'type' in row && !('category' in row))
      .map(({ pack, row }) => ({ key: row.key, type: row.type, pack })),
  ],
  presets: Object.keys(PRESETS).sort(),
  /** Full bodies, not just names — a preset is a motion value with a name, and a conforming
   *  implementation expands the same value. */
  presetDefinitions: PRESETS,
};
const vocabJson = `${JSON.stringify(vocabulary, null, 2)}\n`;

const json = `${JSON.stringify({ url: DOCS, entries, payloads }, null, 2)}\n`;

/**
 * The documentation block, owned end to end. `--check` compares it exactly, so a vocabulary change
 * that skips the docs fails the gate instead of being noticed months later by a reader.
 */
const DOC_TARGETS = ['llms.txt', 'packages/directives/README.md'];
const block = payloads
  .map(({ bases, vars }) => `- ${bases.map((b) => (b === '*' ? 'every base' : `\`${b}\``)).join(', ')} — ${vars.join(' ')}`)
  .join('\n');

/** Replace what sits between the markers, leaving the prose around them alone. */
const MARKERS = /(<!--payloads-->)[\s\S]*?(<!--\/payloads-->)/;
const docWrites = [];
for (const target of DOC_TARGETS) {
  const url = new URL(`../${target}`, import.meta.url);
  const text = readFileSync(url, 'utf8');
  if (!MARKERS.test(text)) continue;
  const next = text.replace(MARKERS, `$1\n${block}\n$2`);
  if (next !== text) docWrites.push([url, next, target]);
}

if (process.argv.includes('--check')) {
  if (docWrites.length) {
    console.error(
      `the payload vocabulary in ${docWrites.map(([, , t]) => t).join(', ')} is stale.\n` +
        `Run: node scripts/sync-diagnostics.mjs`
    );
    process.exit(1);
  }
  let vocabCurrent = '';
  try {
    vocabCurrent = readFileSync(VOCAB_OUT, 'utf8');
  } catch { /* missing counts as stale */ }
  if (vocabCurrent !== vocabJson) {
    console.error(`motion-vocabulary.json is stale.\nRun: node scripts/sync-diagnostics.mjs`);
    process.exit(1);
  }
  let current = '';
  try {
    current = readFileSync(OUT, 'utf8');
  } catch {
    /** Missing counts as stale — the message below says how to fix either case. */
  }
  if (current !== json) {
    console.error(
      `diagnostics.json is stale.\n` +
        `  ${fileURLToPath(OUT)}\n` +
        `Run: node scripts/sync-diagnostics.mjs`
    );
    process.exit(1);
  }
  for (const { name, out, json: tableJson, entries: list } of TABLES) {
    let tableCurrent = '';
    try {
      tableCurrent = readFileSync(out, 'utf8');
    } catch { /* missing counts as stale */ }
    if (tableCurrent !== tableJson) {
      console.error(`packages/${name}/diagnostics.json is stale.\nRun: node scripts/sync-diagnostics.mjs`);
      process.exit(1);
    }
    console.log(`packages/${name}/diagnostics.json is current (${list.length} codes)`);
  }
  console.log(`diagnostics.json is current (${entries.length} codes)`);
} else {
  writeFileSync(OUT, json);
  for (const { out, json: tableJson } of TABLES) writeFileSync(out, tableJson);
  writeFileSync(VOCAB_OUT, vocabJson);
  for (const [url, next] of docWrites) writeFileSync(url, next);
  console.log(`diagnostics.json written (${entries.length} codes, ${payloads.length} payload groups)` +
    (docWrites.length ? `; docs updated: ${docWrites.map(([, , t]) => t).join(', ')}` : ''));
}
