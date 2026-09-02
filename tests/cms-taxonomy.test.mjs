/**
 * Taxonomies: terms are entries, references are checked across collections at build time, and the
 * usage index feeds clouds and navs. The headline assertion is the refusal — a typo'd term slug
 * fails the publish naming the file, the field, the slug, and both honest fixes. Build-time
 * referential integrity is the one thing a database CMS claims a flat-file one cannot have; this
 * suite is that claim, held.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from './dist.mjs';

const { parseSchema, generateTaxonomies, serializeTaxonomies, generateManifest } = await load('cms/publish');
const { buildManifests } = await load('cms/node');
const { createReader } = await load('cms/content');

const SCHEMA = parseSchema(
  JSON.stringify({
    version: 1,
    collections: {
      posts: { fields: { tags: { type: 'taxonomy', taxonomy: 'tags' } } },
      tags: {},
    },
  })
);

const manifest = (collection, rows) => ({
  version: 1,
  collection,
  entries: rows.map(([slug, data]) => ({ slug, uuid: `u-${slug}`, data: { title: slug, ...data }, excerpt: null })),
});

test('the schema refuses a taxonomy pointing at no collection, and a bad value shape is an error', () => {
  assert.throws(
    () => parseSchema(JSON.stringify({ version: 1, collections: { posts: { fields: { tags: { type: 'taxonomy', taxonomy: 'topics' } } } } })),
    /points at taxonomy "topics", which is not a declared collection/
  );
  assert.throws(
    () => generateManifest('posts', [{ name: 'a.md', text: '---\nuuid: u\ntitle: T\ntags: not-a-list\n---\nx' }], SCHEMA.collections.posts),
    /"tags": expected a list of "tags" term slugs/
  );
});

test('the usage index counts per term per collection, unused terms at zero, everything sorted', () => {
  const manifests = new Map([
    ['posts', manifest('posts', [['a', { tags: ['zeta', 'alpha'] }], ['b', { tags: ['alpha'] }]])],
    ['tags', manifest('tags', [['alpha', {}], ['zeta', {}], ['unused', {}]])],
  ]);
  const { index, errors } = generateTaxonomies(SCHEMA, manifests);
  assert.deepEqual(errors, []);
  assert.deepEqual(Object.keys(index.taxonomies.tags), ['alpha', 'unused', 'zeta']);
  assert.deepEqual(index.taxonomies.tags.alpha, { count: 2, collections: { posts: 2 } });
  assert.deepEqual(index.taxonomies.tags.unused, { count: 0, collections: {} });
  assert.equal(serializeTaxonomies(index), serializeTaxonomies(generateTaxonomies(SCHEMA, manifests).index));
});

test('a dangling term reference is an error naming the file, the slug, and both fixes', () => {
  const manifests = new Map([
    ['posts', manifest('posts', [['a', { tags: ['desing'] }]])],
    ['tags', manifest('tags', [['design', {}]])],
  ]);
  const { errors } = generateTaxonomies(SCHEMA, manifests);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /posts\/a\.md: "tags" names the term "desing"/);
  assert.match(errors[0], /fix the slug, or create tags\/desing\.md/);
});

test('through the pipeline: the typo fails the build; creating the term file fixes it', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'vera-cms-tax-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const content = join(root, 'content');
  mkdirSync(join(content, 'posts'), { recursive: true });
  mkdirSync(join(content, 'tags'), { recursive: true });
  writeFileSync(
    join(content, 'schema.json'),
    JSON.stringify({ version: 1, collections: { posts: { fields: { tags: { type: 'taxonomy', taxonomy: 'tags' } } }, tags: {} } })
  );
  writeFileSync(join(content, 'posts', 'a.md'), '---\nuuid: u1\ntitle: A\ntags: [design]\n---\nx');
  const out = join(root, '_manifests');

  assert.throws(() => buildManifests({ content, out }), /names the term "design"/);

  writeFileSync(join(content, 'tags', 'design.md'), '---\nuuid: u2\ntitle: Design\n---\nAbout design.');
  const { written } = buildManifests({ content, out });
  assert.ok(written.some((path) => path.endsWith('taxonomies.json')));
});

test('reader.terms joins term entries with their counts — the tag cloud in one call', async () => {
  const files = {
    /** Slug-sorted, as every real manifest is — the generator guarantees it, so fixtures honor it. */
    'tags.json': manifest('tags', [['css', {}], ['design', {}]]),
    'taxonomies.json': { version: 1, taxonomies: { tags: { design: { count: 3, collections: { posts: 3 } }, css: { count: 0, collections: {} } } } },
  };
  globalThis.fetch = async (url) => {
    const name = String(url).split('/').pop();
    return files[name] ? new Response(JSON.stringify(files[name])) : new Response('', { status: 404 });
  };
  const reader = createReader();
  const terms = await reader.terms('tags');
  assert.deepEqual(
    terms.map((term) => [term.slug, term.count, term.data.title]),
    [['css', 0, 'css'], ['design', 3, 'design']]
  );
});

test('a transient index failure retries; only true absence reads as empty — audit pass 8', async () => {
  let calls = 0;
  const rows = manifest('tags', [['design', {}]]);
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('tags.json')) return new Response(JSON.stringify(rows));
    calls++;
    return calls === 1
      ? new Response('flaky', { status: 500 })
      : new Response(JSON.stringify({ version: 1, taxonomies: { tags: { design: { count: 4, collections: { posts: 4 } } } } }));
  };
  const reader = createReader();
  await assert.rejects(reader.terms('tags'), /taxonomy index \(HTTP 500\)/);
  const terms = await reader.terms('tags');
  assert.equal(terms[0].count, 4, 'the rejection must not be cached — the retry sees the real index');
});

test('a site with no taxonomies serves no index, and the reader reads that as empty, not broken', async () => {
  globalThis.fetch = async (url) =>
    String(url).endsWith('tags.json')
      ? new Response(JSON.stringify(manifest('tags', [['lonely', {}]])))
      : new Response('', { status: 404 });
  const terms = await createReader().terms('tags');
  assert.deepEqual(terms.map((term) => [term.slug, term.count]), [['lonely', 0]]);
});
