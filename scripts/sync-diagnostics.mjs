/**
 * Generates `packages/directives/diagnostics.json` from the diagnostics table — every refusal the
 * package can record, as DATA.
 *
 * Three consumers, one source. The development bundle renders these sentences into the console;
 * `docs.verajs.dev/e/<code>` is a page per entry; and **Vera Studio** ships this file so its
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

const OUT = new URL('../packages/directives/diagnostics.json', import.meta.url);

/**
 * Imported straight from source rather than a bundle, and that is deliberate: `PROSE` must NOT be
 * re-exported from the package index, because a live export is a reference rollup cannot drop —
 * which would keep the whole table in the production bundle and undo the 1,035 B it exists to
 * recover. Node strips the type annotations; the module imports nothing.
 */
const { PROSE } = await import('../packages/directives/src/diagnostics.ts');
/** The same constant the production bundle prints, never a second copy of the string. */
const { DOCS } = await import('../packages/directives/src/docs-url.ts');
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

const entries = Object.keys(PROSE).sort().map((code) => {
  const params = paramsOf(PROSE[code]);
  const [message, fix] = PROSE[code](...params.map((p) => `{${p}}`));
  return { code, params, message, ...(fix ? { fix } : {}) };
});

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
  console.log(`diagnostics.json is current (${entries.length} codes)`);
} else {
  writeFileSync(OUT, json);
  for (const [url, next] of docWrites) writeFileSync(url, next);
  console.log(`diagnostics.json written (${entries.length} codes, ${payloads.length} payload groups)` +
    (docWrites.length ? `; docs updated: ${docWrites.map(([, , t]) => t).join(', ')}` : ''));
}
