/**
 * **A changeset is an instruction a tool acts on later, and nothing was reading them.**
 *
 * `sync-packages` checks the manifests and `tag-release` checks tags against versions; between
 * those two sits the thing that decides what the next version *is*, unchecked. Three of thirty-nine
 * had taken the Changesets default and marked a feature `minor` — which, while `0.x`, is this
 * project's breaking boundary, because `^0.1.2` installs `0.1.3` and never `0.2.0`. One of them
 * would have taken a brand-new package from 0.1.0 to 0.2.0 and told every consumer with a caret
 * range to opt in by hand.
 *
 * What is checked here is the part that has a right answer. **Whether a change is breaking is a
 * judgement**, and a test that guessed would either be wrong or be deleted — so the rule lives in
 * `.changeset/README.md`, where the person writing one will read it, and this asserts only what a
 * machine can know.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;

const published = new Set();
for (const entry of readdirSync(`${root}packages`)) {
  const manifest = `${root}packages/${entry}/package.json`;
  if (!existsSync(manifest)) continue;
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
  if (!pkg.private) published.add(pkg.name);
}

const changesets = readdirSync(`${root}.changeset`).filter((f) => f.endsWith('.md') && f !== 'README.md');

test('there are changesets to check', () => {
  assert.ok(published.size >= 8, `found ${published.size} published packages`);
});

test('every changeset is well formed and names published packages', () => {
  const problems = [];
  for (const file of changesets) {
    const text = readFileSync(`${root}.changeset/${file}`, 'utf8');
    const frontmatter = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
    if (!frontmatter) {
      problems.push(`${file}: no frontmatter`);
      continue;
    }
    const lines = frontmatter[1].split('\n').filter((line) => line.trim());
    if (!lines.length) problems.push(`${file}: names no package`);
    if (!frontmatter[2].trim()) problems.push(`${file}: has no description`);
    for (const line of lines) {
      const entry = /^['"]([^'"]+)['"]\s*:\s*(\w+)$/.exec(line.trim());
      if (!entry) {
        problems.push(`${file}: cannot read "${line.trim()}"`);
        continue;
      }
      const [, name, bump] = entry;
      if (!published.has(name)) problems.push(`${file}: "${name}" is not a published package`);
      /**
       * **`major` is meaningless while `0.x`** — npm's caret already treats a minor as the break, so
       * a major here would jump to 1.0.0 and announce stability this project has not claimed.
       */
      if (bump !== 'patch' && bump !== 'minor')
        problems.push(`${file}: "${name}" is bumped "${bump}" — while 0.x, only patch and minor apply`);
    }
  }
  assert.deepEqual(problems, [], `\n  ${problems.join('\n  ')}`);
});
