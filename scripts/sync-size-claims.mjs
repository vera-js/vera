/**
 * Regenerates every published size claim from the built artifacts, so the docs cannot drift from
 * the bytes. Run after `npm run build`; CI runs it with `--check`.
 *
 *   node scripts/sync-size-claims.mjs           # rewrite the claims in place
 *   node scripts/sync-size-claims.mjs --check   # fail if any claim is out of date
 *
 * Two tiers, because the comparative table needs nine competing frameworks installed and CI has
 * none of them:
 *
 *   1. Per-module sizes come straight from `packages/*∕dist/*.min.js`. Always computable, so CI
 *      always verifies them. This is the tier that drifted 58% and shipped wrong to npm.
 *   2. The cross-framework table comes from `bench/size-snapshot.json`, written by
 *      `node bench/size.mjs --snapshot`. CI cannot regenerate it, but it can detect staleness: the
 *      snapshot records the per-module sizes as they were when it was taken, so if the dist has
 *      moved since, the snapshot is stale and the check fails.
 *
 * Claims are marked in the docs with HTML comments, which markdown does not render:
 *
 *   inline   <!--size:core.gzip-->3.03 KB<!--/size:core.gzip-->
 *   block    <!--size:table.modules-->…table…<!--/size:table.modules-->
 *
 * Sizes are gzipped with `zlib.gzipSync`, matching `bench/size.mjs`. The `gzip` CLI is NOT
 * equivalent — it writes the original filename and mtime into the header, which adds 20-30 bytes
 * per file and silently inflates every number.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const CHECK = process.argv.includes('--check');

/** Shipped standalone bundles, in the order they are presented publicly. */
const MODULES = [
  { pkg: 'core', dist: 'packages/core/dist/vera.min.js', what: 'state (incl. Map and Set), hooks, lifecycle, render' },
  { pkg: 'renderer', dist: 'packages/renderer/dist/vera-renderer.min.js', what: 'keyed template renderer, refs, `hold`' },
  { pkg: 'router', dist: 'packages/router/dist/vera-router.min.js', what: 'nested routes, params, wildcards, redirects, scroll memory' },
  { pkg: 'autoloader', dist: 'packages/autoloader/dist/vera-autoloader.min.js', what: 'lazy component discovery' },
  { pkg: 'styles', dist: 'packages/styles/dist/vera-styles.min.js', what: '`static styles` adoption, shadow and light DOM' },
  { pkg: 'spread', dir: 'renderer', dist: 'packages/renderer/dist/vera-renderer-spread.min.js', what: '`${spread(props)}` — runtime-named bindings' },
  { pkg: 'tag', dir: 'renderer', dist: 'packages/renderer/dist/vera-renderer-tag.min.js', what: '`<${tag}>` — runtime tag names, in templates and JSX' },
  { pkg: 'computed', dir: 'reactivity', dist: 'packages/reactivity/dist/vera-reactivity-computed.min.js', what: 'memoised derived values' },
  { pkg: 'inserts', dist: 'packages/inserts/dist/vera-inserts.min.js', what: 'the extension point' },
];

/** Files whose claims this script owns. */
const TARGETS = [
  'README.md',
  'llms.txt',
  'docs/features/README.md',
  'docs/features/size.md',
  'docs/features/zero-dependencies.md',
  // The per-package READMEs are what npm serves on each package page, and the only ones that ship
  // inside a tarball. The root README ships nowhere.
  /**
   * A claim's key and the README carrying it are no longer the same name. `spread` is an entry of
   * `@verajs/renderer` and `computed` one of `@verajs/reactivity`, so `dir` says where the README
   * lives when it differs from the claim key. Deduplicated, since one README can hold several.
   */
  ...new Set(MODULES.map((m) => `packages/${m.dir ?? m.pkg}/README.md`)),
];

const SNAPSHOT = 'bench/size-snapshot.json';

/** KB means 1024 bytes throughout, stated in docs/features/size.md so the divisor is never guessed. */
const kb = (n, dp = 2) => `${(n / 1024).toFixed(dp)} KB`;
/** Thin-space grouping matches the existing tables (`1 007 B`). */
const bytes = (n) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} B`;
/** Small modules read better in bytes than in fractions of a KB. */
const size = (n) => (n < 1024 ? bytes(n) : kb(n));

function measureModules() {
  const out = {};
  for (const m of MODULES) {
    if (!existsSync(m.dist)) {
      console.error(`  missing ${m.dist} — run \`npm run build\` first`);
      process.exit(1);
    }
    const buf = readFileSync(m.dist);
    out[m.pkg] = { raw: buf.length, gzip: gzipSync(buf).length };
  }
  return out;
}

const modules = measureModules();

/** Tier 2. Absent or stale, the comparative claims are left untouched rather than silently wrong. */
let snapshot = null;
let snapshotStale = false;
if (existsSync(SNAPSHOT)) {
  snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
  snapshotStale = MODULES.some(
    (m) => snapshot.modules?.[m.pkg]?.gzip !== modules[m.pkg].gzip
  );
}

/** 1st/2nd/3rd/4th... — used for the rank claim, which moves whenever a competitor is added. */
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][n % 100 >= 11 && n % 100 <= 13 ? 0 : n % 10] ?? 'th');

const values = {};
for (const m of MODULES) {
  values[`${m.pkg}.raw`] = size(modules[m.pkg].raw);
  values[`${m.pkg}.gzip`] = size(modules[m.pkg].gzip);
  values[`${m.pkg}.gzip.bytes`] = bytes(modules[m.pkg].gzip);
}

/** What a consumer would ship without a bundler: the two standalone files, unshaken. */
values['stack.bytes'] = bytes(modules.core.gzip + modules.renderer.gzip);

const blocks = {
  'table.modules': [
    '| Module | Standalone | gzipped |',
    '| --- | ---: | ---: |',
    ...MODULES.map(
      (m) =>
        `| \`@verajs/${m.pkg}\` | ${size(modules[m.pkg].raw)} | ${
          m.pkg === 'core' ? `**${size(modules[m.pkg].gzip)}**` : size(modules[m.pkg].gzip)
        } |`
    ),
  ].join('\n'),

  'table.permodule': [
    '| Module | gzip | |',
    '| --- | ---: | --- |',
    ...MODULES.map((m) => `| \`@verajs/${m.pkg}\` | ${bytes(modules[m.pkg].gzip)} | ${m.what} |`),
  ].join('\n'),
};

if (snapshot && !snapshotStale) {
  const apps = snapshot.apps;
  const smallest = apps[0].gzip;
  const vera = apps.filter((a) => a.name.startsWith('VeraJS'));
  const own = vera.find((a) => a.name.includes('own renderer'));
  const react = apps.find((a) => a.name === 'React');

  values['app.bytes'] = bytes(own.gzip);
  values['app.kb'] = kb(own.gzip, 1);
  values['react.kb'] = kb(react.gzip, 0);
  values['app.rank'] = ordinal(apps.indexOf(own) + 1);
  values['app.count'] = String(apps.length);

  /**
   * The keyed-list shape. A counter is the measurement that flatters a directive-first design —
   * everything a list needs sits behind an import a counter never makes — so the claim quotes both
   * or it quotes the comparison at its least representative point.
   */
  if (snapshot.lists?.length) {
    const listOwn = snapshot.lists.find((a) => a.name.includes('own renderer'));
    const listLit = snapshot.lists.find((a) => a.name === 'Lit');
    if (listOwn) {
      values['list.bytes'] = bytes(listOwn.gzip);
      values['list.kb'] = kb(listOwn.gzip, 1);
    }
    if (listLit) {
      values['list.lit.bytes'] = bytes(listLit.gzip);
      values['list.lit.kb'] = kb(listLit.gzip, 1);
    }
    if (listOwn && listLit) values['list.vs-lit.bytes'] = bytes(listLit.gzip - listOwn.gzip);
  }

  /** Every contender addressable by slug, so prose can cite any of them and stay in sync. */
  for (const a of apps) {
    const slug = a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    values[`app.${slug}.bytes`] = bytes(a.gzip);
    values[`app.${slug}.kb`] = kb(a.gzip, 1);
  }

  blocks['table.deps'] = [
    '| Framework | third-party deps | what they are |',
    '| --- | ---: | --- |',
    ...[...apps]
      .sort((a, b) => a.depsThirdParty - b.depsThirdParty || a.gzip - b.gzip)
      .map((a) => {
        const label = a.name.startsWith('VeraJS') ? `**${a.name}**` : a.name;
        const n = a.depsThirdParty;
        const n2 = a.name.startsWith('VeraJS') ? `**${n}**` : String(n);
        const names = a.depsThirdPartyNames ?? [];
        const shown = names.slice(0, 4).map((x) => `\`${x}\``).join(', ');
        const rest = names.length > 4 ? `, +${names.length - 4} more` : '';
        return `| ${label} | ${n2} | ${n === 0 ? '—' : shown + rest} |`;
      }),
  ].join('\n');

  blocks['table.evidence'] = [
    '| Framework | gzip | vs smallest |',
    '| --- | ---: | ---: |',
    ...apps.map((a) => {
      const label = a.name.startsWith('VeraJS') ? `**${a.name}**` : a.name;
      const g = a.name.startsWith('VeraJS') ? `**${bytes(a.gzip)}**` : bytes(a.gzip);
      return `| ${label}${a.name === 'Solid' ? ' *(needs a compiler)*' : ''} | ${g} | ${(a.gzip / smallest).toFixed(1)}x |`;
    }),
  ].join('\n');
}

/** Replace marked regions. Unknown markers are an error: a typo must not pass silently. */
const unknown = [];
function apply(text, file) {
  const seen = new Set();
  const out = text.replace(
    /<!--size:([\w.-]+)-->([\s\S]*?)<!--\/size:\1-->/g,
    (whole, name) => {
      seen.add(name);
      const replacement = blocks[name] ?? values[name];
      if (replacement === undefined) {
        // A comparative claim with no fresh snapshot: leave it, and let the staleness check report.
        if (snapshotStale || !snapshot) return whole;
        unknown.push(`${file}: <!--size:${name}-->`);
        return whole;
      }
      const wrap = blocks[name] ? `\n${replacement}\n` : replacement;
      return `<!--size:${name}-->${wrap}<!--/size:${name}-->`;
    }
  );
  return { out, seen };
}

let drifted = [];
let total = 0;
for (const file of TARGETS) {
  const before = readFileSync(file, 'utf8');
  const { out, seen } = apply(before, file);
  total += seen.size;
  if (out !== before) {
    drifted.push(file);
    if (!CHECK) writeFileSync(file, out);
  }
}

if (total === 0) {
  console.error('  no <!--size:*--> markers found in any target file — nothing is being kept in sync');
  process.exit(1);
}

if (unknown.length) {
  console.error('  unknown claim marker(s) — no such measurement:');
  for (const u of unknown) console.error(`    ${u}`);
  process.exit(1);
}

/** A surviving placeholder means a marker was malformed and the regex never saw it. */
for (const file of TARGETS) {
  if (/PENDING/.test(readFileSync(file, 'utf8'))) {
    console.error(`  ${file}: an unresolved PENDING placeholder remains — check the marker spelling`);
    process.exit(1);
  }
}

if (CHECK) {
  if (snapshotStale) {
    console.error(`  ${SNAPSHOT} is stale: dist has changed since it was taken.`);
    console.error('  Re-run: node bench/size.mjs --snapshot   (needs the bench devDependencies)');
    process.exit(1);
  }
  if (!snapshot) {
    console.error(`  ${SNAPSHOT} is missing. Run: node bench/size.mjs --snapshot`);
    process.exit(1);
  }
  if (drifted.length) {
    console.error('  size claims are out of date in:');
    for (const f of drifted) console.error(`    ${f}`);
    console.error('  Fix with: node scripts/sync-size-claims.mjs');
    process.exit(1);
  }
  console.log(`  size claims up to date (${total} across ${TARGETS.length} files)`);
} else {
  if (snapshotStale) console.log(`  note: ${SNAPSHOT} is stale — comparative claims left untouched.`);
  console.log(
    drifted.length
      ? `  updated ${drifted.length} file(s): ${drifted.join(', ')}`
      : `  size claims already up to date (${total} claims)`
  );
}
