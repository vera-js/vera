/**
 * **The one way to build a probe variant of a package** (2026-11-08): BOTH bundles, each shown to DIFFER from the tree's
 * current build before anyone reads it. A bare `npx rollup -c` in a package writes only `dist/development` (the minified
 * build needs `MODE=prod`, which wireit sets), so variants read from the minified bundle were silently the unmodified
 * build, and a "five orders are byte-identical" result measured one bundle five times.
 *
 *   node scripts/build-variant.mjs <package> <name> [--same]
 *
 * With the package's SOURCE edited to the variant: builds development and production, refuses unless both main
 * bundles differ from the current `dist` (`--same` inverts it, for an intended byte-identical A/A copy), copies both into
 * `.probe/variants/<name>/` with a stamp (the source diff's hash and every bundle hash), and puts the package's `dist`
 * back exactly as it was, so the build cache still describes it. Restoring the SOURCE is the caller's.
 */
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const [pkg, name] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const same = process.argv.includes('--same');
if (!pkg || !name) throw new Error('usage: node scripts/build-variant.mjs <package> <name> [--same]');
const dir = join(root, 'packages', pkg);
const dist = join(dir, 'dist');

const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 12);
/** Every built file of the package (bundles and maps), relative to `dist`. */
const files = () => [
  ...readdirSync(dist).filter((f) => f.endsWith('.min.js') || f.endsWith('.min.js.map')),
  ...(existsSync(join(dist, 'development')) ? readdirSync(join(dist, 'development')).map((f) => `development/${f}`) : []),
];
/** The package's main bundles: its first production and first development `.js`, the pair the guard compares. */
const mains = () => {
  const prod = files().filter((f) => f.endsWith('.min.js')).sort()[0];
  const dev = files().filter((f) => f.startsWith('development/') && f.endsWith('.js')).sort()[0];
  if (!prod || !dev) throw new Error(`build-variant: ${pkg} has no built bundles; build the tree first (npm run build)`);
  return { prod, dev };
};

/** The current build, byte for byte, so it can be put back after the variant is copied out. */
const { prod, dev } = mains();
const saved = new Map(files().map((f) => [f, readFileSync(join(dist, f))]));
const before = { prod: sha(join(dist, prod)), dev: sha(join(dist, dev)) };

const build = (mode) => execFileSync('npx', ['rollup', '-c', '--silent'], { cwd: dir, env: { ...process.env, ...(mode ? { MODE: mode } : {}) }, stdio: 'pipe' });
/** Held until dist is put back and checked, so a refusal or a failed build still proves the restore. */
let failure;
try {
  build(undefined);
  build('prod');
  const after = { prod: sha(join(dist, prod)), dev: sha(join(dist, dev)) };
  const changed = { prod: after.prod !== before.prod, dev: after.dev !== before.dev };
  console.log(`${pkg}/${name}: prod ${before.prod} -> ${after.prod}${changed.prod ? '' : ' (UNCHANGED)'}; dev ${before.dev} -> ${after.dev}${changed.dev ? '' : ' (UNCHANGED)'}`);
  if (same ? changed.prod || changed.dev : !(changed.prod && changed.dev))
    throw new Error(same ? 'build-variant --same: a bundle changed, so this is not an A/A copy' : 'build-variant: a bundle did not change, so the variant would measure the current build; refused');
  const out = join(root, '.probe', 'variants', name);
  mkdirSync(join(out, 'development'), { recursive: true });
  for (const f of files()) copyFileSync(join(dist, f), join(out, f));
  const diff = execSync(`git diff -- packages/${pkg}`, { cwd: root });
  writeFileSync(join(out, 'STAMP'), `${pkg}/${name}\nsource diff ${createHash('sha256').update(diff).digest('hex').slice(0, 12)} (${diff.length} bytes)\n${files().map((f) => `${sha(join(dist, f))} ${f}`).join('\n')}\n`);
  console.log(`  written to .probe/variants/${name}/ (STAMP: source diff ${createHash('sha256').update(diff).digest('hex').slice(0, 12)})`);
} catch (error) {
  failure = error;
}
/** The package's dist goes back to the bytes it had, whatever happened above, and the restore is checked on every path. */
for (const [f, bytes] of saved) writeFileSync(join(dist, f), bytes);
const restored = { prod: sha(join(dist, prod)), dev: sha(join(dist, dev)) };
if (restored.prod !== before.prod || restored.dev !== before.dev) throw new Error('build-variant: dist was not restored');
console.log(`  dist restored (prod ${restored.prod}, dev ${restored.dev})`);
if (failure) throw failure;
