/**
 * The manifest generator: the static index that answers "what entries exist" in one fetch.
 *
 * The load-bearing assertion is determinism under shuffled input — directory enumeration order is
 * the environment-shaped thing most likely to leak into a committed artifact, and a manifest that
 * differs by machine can never be drift-checked. The rest: the row shape, the warning-not-error
 * stance on missing identity, the error-with-file-context stance on broken files, and the boundary
 * itself — a site's `content` entry must not even carry the generator.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from './dist.mjs';

const { generateManifest, serializeManifest } = await load('cms/publish');

const FILES = [
  {
    name: 'hello-world.md',
    text: '---\nuuid: 018f-aaaa\ntitle: Hello World\ndate: 2026-09-01\ntags: [intro, news]\n---\nFirst *paragraph* with `code` and <mark>html</mark> in it.\n\nSecond paragraph.',
  },
  {
    name: 'about.md',
    text: '---\nuuid: 018f-bbbb\ntitle: About\n---\n# Opens with a heading',
  },
  {
    name: 'zebra.md',
    text: '---\nuuid: 018f-cccc\ntitle: Zebra\n---\nPlain opener.',
  },
];

test('rows carry slug, uuid, data verbatim, and a plain-text excerpt', () => {
  const { manifest, warnings } = generateManifest('posts', FILES);
  assert.deepEqual(warnings, []);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.collection, 'posts');
  assert.deepEqual(manifest.entries[1], {
    slug: 'hello-world',
    uuid: '018f-aaaa',
    data: { uuid: '018f-aaaa', title: 'Hello World', date: '2026-09-01', tags: ['intro', 'news'] },
    /** Formatting flattens to text; HTML tags vanish but the prose inside them stays — it IS content. */
    excerpt: 'First paragraph with code and html in it.',
  });
});

test('a body that opens with anything but a paragraph gets no excerpt, not a guess', () => {
  const { manifest } = generateManifest('posts', FILES);
  assert.equal(manifest.entries.find((entry) => entry.slug === 'about').excerpt, null);
});

test('an image-only opener answers null, not an empty string — audit pass 8', () => {
  const { manifest } = generateManifest('posts', [{ name: 'a.md', text: '---\nuuid: u\ntitle: T\n---\n![alt](/i.png)' }]);
  assert.equal(manifest.entries[0].excerpt, null);
});

test('entries sort by slug whatever order files arrive in — enumeration order is environment', () => {
  const forward = serializeManifest(generateManifest('posts', FILES).manifest);
  const reversed = serializeManifest(generateManifest('posts', [...FILES].reverse()).manifest);
  assert.equal(forward, reversed);
  assert.deepEqual(
    generateManifest('posts', FILES).manifest.entries.map((entry) => entry.slug),
    ['about', 'hello-world', 'zebra']
  );
});

test('a missing uuid warns — returned, not printed — and still indexes', () => {
  const { manifest, warnings } = generateManifest('posts', [{ name: 'legacy.md', text: '---\ntitle: Old\n---\nBody.' }]);
  assert.equal(manifest.entries[0].uuid, null);
  assert.equal(manifest.entries[0].data.title, 'Old');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /posts\/legacy\.md has no uuid/);
  assert.match(warnings[0], /rename will orphan/);
});

test('a broken file fails the build with the file named around the parser’s own line', () => {
  assert.throws(
    () => generateManifest('posts', [{ name: 'bad.md', text: '---\na: {b: 1}\n---\nx' }]),
    /generateManifest: posts\/bad\.md: parseFrontmatter: line 2: flow maps/
  );
});

test('the serialized artifact is stable bytes with a trailing newline', () => {
  const text = serializeManifest(generateManifest('posts', FILES).manifest);
  assert.equal(text, serializeManifest(generateManifest('posts', FILES).manifest));
  assert.ok(text.endsWith('}\n'));
  assert.equal(JSON.parse(text).entries.length, 3);
});

test('the content entry does not carry the generator — the subpath boundary, held', async () => {
  const content = await load('cms/content');
  assert.equal(content.generateManifest, undefined);
  assert.equal(content.serializeManifest, undefined);
});
