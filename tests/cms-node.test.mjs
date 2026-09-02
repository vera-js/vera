/**
 * The Node face of the publish pipeline, run against a real (temporary) content tree — and the CLI
 * over it, spawned as the process a user actually runs. The load-bearing pair: build writes
 * byte-stable artifacts, and `--check` refuses the moment content and artifacts disagree — the
 * drift discipline every committed generated file in this repository carries.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load, distUrl } from './dist.mjs';

const { buildManifests, checkManifests } = await load('cms/node');

/** A little site: two collections, one entry missing its uuid on purpose. */
const site = () => {
  const root = mkdtempSync(join(tmpdir(), 'vera-cms-'));
  const posts = join(root, 'content', 'posts');
  const pages = join(root, 'content', 'pages');
  mkdirSync(posts, { recursive: true });
  mkdirSync(pages, { recursive: true });
  writeFileSync(join(posts, 'hello.md'), '---\nuuid: 018f-aaaa\ntitle: Hello\ndate: 2026-01-02\n---\nHi there.');
  writeFileSync(join(posts, 'legacy.md'), '---\ntitle: Old\n---\nNo uuid here.');
  writeFileSync(join(pages, 'about.md'), '---\nuuid: 018f-bbbb\ntitle: About\n---\nAbout.');
  return { root, content: join(root, 'content'), out: join(root, '_manifests') };
};

test('build writes one manifest per collection plus the site index', (t) => {
  const { root, content, out } = site();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const { written, warnings } = buildManifests({ content, out });
  assert.deepEqual(
    written.map((path) => path.slice(out.length + 1)),
    ['pages.json', 'posts.json', 'site.json']
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /posts\/legacy\.md has no uuid/);

  const posts = JSON.parse(readFileSync(join(out, 'posts.json'), 'utf8'));
  assert.deepEqual(posts.entries.map((entry) => entry.slug), ['hello', 'legacy']);

  const index = JSON.parse(readFileSync(join(out, 'site.json'), 'utf8'));
  assert.deepEqual(index, {
    version: 1,
    collections: [
      { name: 'pages', count: 1 },
      { name: 'posts', count: 2 },
    ],
  });
});

test('an orphaned artifact is reported — a deleted collection cannot keep serving its manifest', (t) => {
  const { root, content, out } = site();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  buildManifests({ content, out });
  rmSync(join(content, 'pages'), { recursive: true });
  const drifted = checkManifests({ content, out });
  assert.deepEqual(drifted.orphaned.map((path) => path.slice(out.length + 1)), ['pages.json']);
  /** site.json changed too (a collection vanished), which is stale, not orphaned. */
  assert.ok(drifted.stale.some((path) => path.endsWith('site.json')));
});

test('check is clean after a build, and names exactly what drifted after an edit', (t) => {
  const { root, content, out } = site();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  buildManifests({ content, out });
  assert.deepEqual(checkManifests({ content, out }), { stale: [], missing: [], orphaned: [] });

  writeFileSync(join(content, 'posts', 'hello.md'), '---\nuuid: 018f-aaaa\ntitle: Hello Edited\ndate: 2026-01-02\n---\nHi.');
  const drifted = checkManifests({ content, out });
  /** Only posts drifted — pages must not be blamed for it. The site index survives: counts did not change. */
  assert.deepEqual(drifted.stale.map((path) => path.slice(out.length + 1)), ['posts.json']);
  assert.deepEqual(drifted.missing, []);
  assert.deepEqual(drifted.orphaned, []);
});

test('check reports never-built artifacts as missing, not stale', (t) => {
  const { root, content, out } = site();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { missing } = checkManifests({ content, out });
  assert.deepEqual(missing.map((path) => path.slice(out.length + 1)), ['pages.json', 'posts.json', 'site.json']);
});

test('a rebuild over unchanged content is byte-identical — no environment leaks into the artifacts', (t) => {
  const { root, content, out } = site();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  buildManifests({ content, out });
  const first = readFileSync(join(out, 'posts.json'), 'utf8');
  buildManifests({ content, out });
  assert.equal(readFileSync(join(out, 'posts.json'), 'utf8'), first);
});

// ── the CLI, as the process a user runs ─────────────────────────────────────────────────────────

const CLI = new URL(distUrl('cms/node').replace('vera-cms-node', 'vera-cms-cli')).pathname;
const run = (args, cwd) => {
  /** `spawnSync`, because warnings land on stderr and a passing run has those too. */
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
};

test('the CLI builds, checks clean, refuses drift with the file named, and rejects unknown flags', (t) => {
  const { root } = site();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const built = run([], root);
  assert.equal(built.code, 0);
  assert.match(built.output, /wrote 3 files/);
  assert.match(built.output, /legacy\.md has no uuid/);

  assert.equal(run(['--check'], root).code, 0);

  writeFileSync(join(root, 'content', 'posts', 'hello.md'), '---\nuuid: 018f-aaaa\ntitle: Drifted\n---\nHi.');
  const refused = run(['--check'], root);
  assert.equal(refused.code, 1);
  assert.match(refused.output, /posts\.json is stale/);
  assert.match(refused.output, /Rebuild and commit/);

  const unknown = run(['--frobnicate'], root);
  assert.equal(unknown.code, 1);
  assert.match(unknown.output, /unknown argument "--frobnicate"/);

  /** Failures present as the CLI's sentence, never a raw stack — the final audit's last catch. */
  const empty = run(['--content='], root);
  assert.equal(empty.code, 1);
  assert.match(empty.output, /unknown argument "--content="/);
  const gone = run(['--content=/nonexistent-dir'], root);
  assert.equal(gone.code, 1);
  assert.match(gone.output, /^vera-cms: ENOENT/m);
  assert.doesNotMatch(gone.output, /at .*node:/, 'no stack trace reaches the user');
});
