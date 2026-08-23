/**
 * Create an annotated git tag for every publishable package at its current version.
 *
 *   node scripts/tag-release.mjs          # create tags
 *   node scripts/tag-release.mjs --check  # verify, create nothing (CI-safe)
 *
 * Run **after** committing what `changeset version` produced, and before pushing. Tags are created
 * locally rather than by CI so that .github/workflows/release.yml can stay `contents: read` — see
 * docs/RELEASING.md. Existing tags are left alone, so re-running is safe.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const check = process.argv.includes('--check');
const force = process.argv.includes('--force');

const git = (cmd) => execSync(`git ${cmd}`, { encoding: 'utf8' }).trim();

/**
 * A dirty tree here means the release is about to go wrong, in one of two ways that have both
 * actually happened:
 *
 * - `changeset version` was run and never committed. The push then carries the *old* versions, CI
 *   finds them already on the registry, and the release publishes nothing while reporting success.
 * - It was committed, but this script ran first. Tags name `HEAD`, so every tag lands on the commit
 *   before its own bump — `@verajs/core@0.2.1` sitting on a tree that says `0.2.0`. Publishing is
 *   unaffected, because CI compares manifests against the registry and never reads a tag, which is
 *   exactly why this went unnoticed for several releases.
 *
 * One check catches both: commit first, then tag, and the tree is clean at this point.
 */
if (!check) {
  const dirty = git('status --porcelain');
  if (dirty && !force) {
    console.error(
      'tag-release: refusing to tag a dirty working tree.\n\n' +
        dirty.split('\n').map((l) => `  ${l}`).join('\n') +
        '\n\nTags name HEAD, so tagging now would point them at a commit that does not contain\n' +
        'the versions they name — and if these are uncommitted `changeset version` bumps, the\n' +
        'push would publish nothing at all.\n\n' +
        '  git add -A && git commit -m "release: …"   then re-run\n\n' +
        'Pass --force only if you are certain the tree is unrelated to the release.'
    );
    process.exit(1);
  }
}

const packages = [];
for (const dir of readdirSync('packages')) {
  const manifest = JSON.parse(readFileSync(`packages/${dir}/package.json`, 'utf8'));
  if (manifest.private) continue;
  packages.push({ dir, name: manifest.name, version: manifest.version });
}

const existing = new Set(git('tag').split('\n').filter(Boolean));

/**
 * No tags at all, in a repo that has publishable packages, is a shallow checkout rather than a
 * repo nobody has ever released. `actions/checkout` fetches neither tags nor history by default,
 * which made this script report all ten packages as untagged the first time it ran in CI.
 */
if (!existing.size && packages.length) {
  const message =
    'tag-release: this repository has no tags at all.\n' +
    '  In CI that means the checkout fetched none — actions/checkout needs `fetch-depth: 0`.\n' +
    '  Locally it means `git fetch --tags`.';
  if (check) {
    console.error(message);
    process.exit(1);
  }
  console.warn(message);
}
const missing = [];
const mismatched = [];

for (const { dir, name, version } of packages) {
  const tag = `${name}@${version}`;
  if (existing.has(tag)) {
    /**
     * A tag that exists but names a tree with a different version is the ordering bug above,
     * already committed to history. Reported rather than repaired: rewriting a pushed ref is worse
     * than leaving a wrong one, and nothing reads these tags to decide what publishes.
     */
    let tagged;
    try {
      tagged = JSON.parse(
        execSync(`git show ${JSON.stringify(`${tag}^{commit}:packages/${dir}/package.json`)}`, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'],
        })
      ).version;
    } catch {
      continue; // the package did not exist at that commit; nothing to compare
    }
    if (tagged !== version) mismatched.push(`${tag} → tree says ${tagged}`);
    continue;
  }
  missing.push(tag);
  if (!check) {
    execSync(`git tag -a ${JSON.stringify(tag)} -m ${JSON.stringify(tag)}`, { stdio: 'inherit' });
    console.log(`tagged ${tag}`);
  }
}

if (mismatched.length) {
  console.warn(
    `tag-release: ${mismatched.length} existing tag(s) name a commit with a different version:\n` +
      mismatched.map((m) => `  ${m}`).join('\n') +
      '\n  (historical; left alone deliberately — see docs/RELEASING.md)'
  );
}

if (!missing.length) console.log('tag-release: every publishable package is already tagged');
else if (check) {
  console.error(`tag-release: missing ${missing.length} tag(s):\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
