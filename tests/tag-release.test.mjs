/**
 * `scripts/tag-release.mjs` — the release tooling, tested because it silently failed a release.
 *
 * Two ordering mistakes are possible and both have happened here. Skipping the commit after
 * `changeset version` means the push carries the old versions, so CI finds them already on the
 * registry and publishes nothing while reporting success. Committing but tagging first means every
 * tag names the commit *before* its own bump, which never blocks a publish — CI compares manifests
 * against the registry and never reads a tag — and so went unnoticed across six releases.
 *
 * A clean-tree check catches both, because "commit, then tag" is the only order that leaves the
 * tree clean at this point. That is what most of this file pins down.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const SCRIPT = new URL('../scripts/tag-release.mjs', import.meta.url).pathname;

/** A throwaway repo with one publishable package and one private one. */
const repo = (version = '1.0.0') => {
  const dir = mkdtempSync(join(tmpdir(), 'vera-tag-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  mkdirSync(join(dir, 'packages/thing'), { recursive: true });
  mkdirSync(join(dir, 'packages/secret'), { recursive: true });
  writeFileSync(join(dir, 'packages/thing/package.json'), JSON.stringify({ name: '@x/thing', version }));
  writeFileSync(join(dir, 'packages/secret/package.json'),
    JSON.stringify({ name: '@x/secret', version, private: true }));
  git('add', '-A');
  git('commit', '-qm', 'initial');
  return { dir, git };
};

/**
 * Both streams, always. `execFileSync` returns stdout only, so an earlier version of this helper
 * silently dropped everything the script reports through `console.warn` whenever the run succeeded
 * — which is exactly how the mismatch warning is emitted.
 */
const run = (dir, args = []) => {
  const r = spawnSync('node', [SCRIPT, ...args], { cwd: dir, encoding: 'utf8' });
  return { code: r.status ?? 1, out: (r.stdout ?? '') + (r.stderr ?? '') };
};

test('tags every publishable package on a clean tree', () => {
  const { dir, git } = repo();
  const { code, out } = run(dir);
  assert.equal(code, 0, out);
  assert.match(out, /tagged @x\/thing@1\.0\.0/);
  const tags = git('tag').trim().split('\n').filter(Boolean);
  assert.deepEqual(tags, ['@x/thing@1.0.0']);
  rmSync(dir, { recursive: true, force: true });
});

test('skips private packages', () => {
  const { dir, git } = repo();
  run(dir);
  assert.doesNotMatch(git('tag'), /secret/, 'a private package is never published, so never tagged');
  rmSync(dir, { recursive: true, force: true });
});

test('refuses a dirty tree — the uncommitted `changeset version` case', () => {
  const { dir, git } = repo();
  writeFileSync(join(dir, 'packages/thing/package.json'), JSON.stringify({ name: '@x/thing', version: '1.1.0' }));
  const { code, out } = run(dir);
  assert.equal(code, 1, 'must fail, not warn — this is the failure that publishes nothing');
  assert.match(out, /refusing to tag a dirty working tree/);
  assert.match(out, /publish nothing at all/, 'the message must say what actually goes wrong');
  assert.equal(git('tag').trim(), '', 'and no tag may be created');
  rmSync(dir, { recursive: true, force: true });
});

test('refuses a dirty tree even when the change is unrelated', () => {
  // Deliberately strict. Nothing here can tell an unrelated edit from an uncommitted bump.
  const { dir } = repo();
  writeFileSync(join(dir, 'README.md'), 'unrelated');
  assert.equal(run(dir).code, 1);
  rmSync(dir, { recursive: true, force: true });
});

test('--force overrides the dirty-tree refusal', () => {
  const { dir, git } = repo();
  writeFileSync(join(dir, 'README.md'), 'unrelated');
  const { code } = run(dir, ['--force']);
  assert.equal(code, 0);
  assert.match(git('tag'), /@x\/thing@1\.0\.0/);
  rmSync(dir, { recursive: true, force: true });
});

test('--check creates nothing and fails when a tag is missing', () => {
  // Needs an unrelated tag present, or the tagless-checkout guard below fires first — which is
  // correct, since a repo with zero tags cannot be told apart from a shallow clone.
  const { dir, git } = repo();
  git('tag', '-a', 'v0', '-m', 'unrelated');
  const { code, out } = run(dir, ['--check']);
  assert.equal(code, 1);
  assert.match(out, /missing 1 tag/);
  assert.equal(git('tag').trim(), 'v0', '--check must never write');
  rmSync(dir, { recursive: true, force: true });
});

test('--check passes on a dirty tree, so CI can run it', () => {
  const { dir } = repo();
  run(dir);                                    // tag first
  writeFileSync(join(dir, 'README.md'), 'x');  // now dirty
  assert.equal(run(dir, ['--check']).code, 0, 'the guard is for tag creation, not verification');
  rmSync(dir, { recursive: true, force: true });
});

test('re-running is a no-op', () => {
  const { dir } = repo();
  run(dir);
  const { code, out } = run(dir);
  assert.equal(code, 0);
  assert.match(out, /already tagged/);
  rmSync(dir, { recursive: true, force: true });
});

test('reports an existing tag whose commit names a different version', () => {
  /**
   * The historical ordering bug, reproduced exactly: tag first, commit second. The tag then names
   * the pre-bump commit. Scoped to each package's *current* version — a tag for some older version
   * is not re-examined, which is the right trade: the versions that matter are the ones a release
   * is about to publish, and walking every tag in history would be noise.
   */
  const { dir, git } = repo('1.0.0');
  writeFileSync(join(dir, 'packages/thing/package.json'), JSON.stringify({ name: '@x/thing', version: '2.0.0' }));
  git('tag', '-a', '@x/thing@2.0.0', '-m', 'tagged before the bump was committed');  // tags HEAD = the 1.0.0 tree
  git('add', '-A');
  git('commit', '-qm', 'release: 2.0.0');
  const { out } = run(dir, ['--check']);
  assert.match(out, /name a commit with a different version/);
  assert.match(out, /@x\/thing@2\.0\.0 → tree says 1\.0\.0/);
  rmSync(dir, { recursive: true, force: true });
});

test('--check fails loudly on a tagless repo rather than listing every package as missing', () => {
  /**
   * A shallow checkout, which is what `actions/checkout` produces by default: no tags and no
   * history. The first CI run of this script reported all ten packages untagged, which reads as a
   * botched release rather than a misconfigured job.
   */
  const { dir } = repo();
  const { code, out } = run(dir, ['--check']);
  assert.equal(code, 1);
  assert.match(out, /no tags at all/);
  assert.match(out, /fetch-depth: 0/, 'the message must name the fix');
  assert.doesNotMatch(out, /missing 1 tag/, 'and must not masquerade as a missing-tag failure');
  rmSync(dir, { recursive: true, force: true });
});

test('does not report a mismatch for a package that did not exist yet', () => {
  const { dir, git } = repo();
  git('tag', '-a', '@x/gone@9.9.9', '-m', 'a tag for something not in packages/');
  const { code, out } = run(dir, ['--check']);
  assert.equal(code, 1, 'still reports the genuinely missing tag');
  assert.doesNotMatch(out, /@x\/gone/);
  rmSync(dir, { recursive: true, force: true });
});
