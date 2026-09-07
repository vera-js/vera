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

const json = `${JSON.stringify({ url: 'https://docs.verajs.dev/e/', entries }, null, 2)}\n`;

if (process.argv.includes('--check')) {
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
  console.log(`diagnostics.json written (${entries.length} codes)`);
}
