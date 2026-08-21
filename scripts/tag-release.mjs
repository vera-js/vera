/**
 * Create an annotated git tag for every publishable package at its current version.
 *
 *   node scripts/tag-release.mjs          # create tags
 *   node scripts/tag-release.mjs --check  # exit 1 if any tag is missing
 *
 * Run after `npx changeset version`, before pushing. Tags are created locally rather than by
 * CI so that .github/workflows/release.yml can stay `contents: read` — see docs/RELEASING.md.
 * Existing tags are left alone, so re-running is safe.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const check = process.argv.includes('--check');
const existing = new Set(execSync('git tag', { encoding: 'utf8' }).split('\n').filter(Boolean));
const missing = [];

for (const dir of readdirSync('packages')) {
  const manifest = JSON.parse(readFileSync(`packages/${dir}/package.json`, 'utf8'));
  if (manifest.private) continue;
  const tag = `${manifest.name}@${manifest.version}`;
  if (existing.has(tag)) continue;
  missing.push(tag);
  if (!check) {
    execSync(`git tag -a ${JSON.stringify(tag)} -m ${JSON.stringify(tag)}`, { stdio: 'inherit' });
    console.log(`tagged ${tag}`);
  }
}

if (!missing.length) console.log('tag-release: every publishable package is already tagged');
else if (check) {
  console.error(`tag-release: missing ${missing.length} tag(s):\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
