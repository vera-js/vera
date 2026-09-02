/**
 * The interchange contract and reference integrity — the two halves of "the schema is a promise
 * the whole world can read." The emitted JSON Schema must mirror the graded strictness exactly
 * (a contract that overstates rejects content the publish accepts), and a reference UUID nothing
 * answers to must fail the publish naming the file — the taxonomy pass's standard, applied to the
 * second cross-collection field kind.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from './dist.mjs';

const { parseSchema, emitJsonSchema, emitJsonSchemas, checkReferences, validateEntry } = await load('cms/publish');
const { buildManifests } = await load('cms/node');
const { createReader } = await load('cms/content');

const SCHEMA = parseSchema(
  JSON.stringify({
    version: 1,
    collections: {
      posts: {
        fields: {
          date: { type: 'date', required: true },
          author: { type: 'reference', collection: 'authors' },
          status: { type: 'select', options: ['draft', 'live'] },
          tags: { type: 'taxonomy', taxonomy: 'tags' },
        },
      },
      authors: {},
      tags: {},
      nav: { title: false, body: false },
    },
  })
);

// ── emission ────────────────────────────────────────────────────────────────────────────────────

test('the emitted contract mirrors the graded strictness — required only where the publish errors', () => {
  const emitted = emitJsonSchema('posts', SCHEMA.collections.posts);
  assert.equal(emitted.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.deepEqual(emitted.required, ['date']); // required:true fields only — never uuid/title, which warn
  assert.equal(emitted.additionalProperties, true); // unknown fields warn, so the contract admits them
  /** Optional fields admit null — a bare `author:` line publishes, so the contract accepts it too. */
  assert.deepEqual(emitted.properties.status, { enum: ['draft', 'live', null] });
  assert.deepEqual(emitted.properties.author, { type: ['string', 'null'], 'x-vera-type': 'reference', 'x-vera-collection': 'authors' });
  assert.deepEqual(emitted.properties.tags, { type: ['array', 'null'], items: { type: 'string' }, 'x-vera-type': 'taxonomy', 'x-vera-taxonomy': 'tags' });
  assert.deepEqual(emitted.properties.date.type, 'string'); // required stays strict: the publish refuses its null too
  assert.equal(emitted.properties.title.type, 'string');
});

test('a title-less collection emits no title property; required is absent when nothing is', () => {
  const emitted = emitJsonSchema('nav', SCHEMA.collections.nav);
  assert.equal(emitted.properties.title, undefined);
  assert.equal(emitted.required, undefined);
  assert.equal(typeof emitted.properties.uuid, 'object'); // identity is always in the contract
});

test('the date pattern in the contract accepts exactly what the validator accepts', () => {
  const pattern = new RegExp(emitJsonSchema('posts', SCHEMA.collections.posts).properties.date.pattern);
  for (const good of ['2026-09-02', '2026-09-02 10:30', '2026-09-02T10:30:15']) {
    assert.match(good, pattern);
    assert.deepEqual(validateEntry({ uuid: 'u', title: 'T', date: good }, SCHEMA.collections.posts).errors, []);
  }
  for (const bad of ['someday', '2026-9-2', '2026-13-01', '2026-01-32', '2026-01-01T25:00']) {
    assert.doesNotMatch(bad, pattern);
    assert.equal(validateEntry({ uuid: 'u', title: 'T', date: bad }, SCHEMA.collections.posts).errors.length, 1);
  }
});

test('everything the publish accepts, the emitted contract validates — proven with a real validator', async () => {
  /**
   * The parity the header promises, held by ajv instead of by matching implementations: publish a
   * document full of the edge shapes (bare nulls on every optional kind), then validate the
   * manifest row against the emitted contract. The first emitter failed exactly this.
   */
  const { default: Ajv } = await import('ajv');
  const { generateManifest, emitJsonSchema } = await load('cms/publish');
  const spec = SCHEMA.collections.posts;
  const { manifest, warnings } = generateManifest('posts', [
    { name: 'nulls.md', text: '---\nuuid: u1\ntitle: T\ndate: 2026-09-02\nauthor:\nstatus: null\ntags: null\n---\nx' },
    { name: 'full.md', text: '---\nuuid: u2\ntitle: T\ndate: 2026-09-02 10:30\nauthor: u-x\nstatus: live\ntags: [a]\n---\nx' },
  ], spec);
  assert.deepEqual(warnings, []);
  const contract = emitJsonSchema('posts', spec);
  delete contract.$schema; // ajv here speaks draft-07; the constructs used are identical in 2020-12
  const ajv = new Ajv({ allErrors: true });
  for (const entry of manifest.entries)
    assert.equal(ajv.validate(contract, entry.data), true, `${entry.slug}: ${JSON.stringify(ajv.errors)}`);
  /** And the contract still rejects what the publish rejects. */
  assert.equal(ajv.validate(contract, { uuid: 'u', title: 'T', date: 'someday' }), false);
  assert.equal(ajv.validate(contract, { uuid: 'u', title: 'T' }), false); // required date absent
});

test('emission is deterministic and covers every collection', () => {
  const first = emitJsonSchemas(SCHEMA);
  assert.deepEqual([...first.keys()], ['authors', 'nav', 'posts', 'tags']);
  assert.deepEqual([...emitJsonSchemas(SCHEMA).entries()], [...first.entries()]);
});

// ── reference integrity ─────────────────────────────────────────────────────────────────────────

const manifest = (collection, rows) => ({
  version: 1,
  collection,
  entries: rows.map(([slug, uuid, data]) => ({ slug, uuid, data: { title: slug, ...data }, excerpt: null })),
});

test('a reference resolves by uuid, so a rename of the target breaks nothing', () => {
  const manifests = new Map([
    ['posts', manifest('posts', [['a', 'u-a', { author: 'u-brian' }]])],
    ['authors', manifest('authors', [['brian-renamed-his-slug', 'u-brian', {}]])],
    ['tags', manifest('tags', [])],
  ]);
  assert.deepEqual(checkReferences(SCHEMA, manifests), []);
});

test('a dangling reference is an error naming the file; an entry without a uuid cannot be referenced', () => {
  const manifests = new Map([
    ['posts', manifest('posts', [['a', 'u-a', { author: 'u-ghost' }], ['b', 'u-b', { author: 'u-null' }]])],
    ['authors', manifest('authors', [['ghostless', null, {}]])],
    ['tags', manifest('tags', [])],
  ]);
  const errors = checkReferences(SCHEMA, manifests);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /posts\/a\.md: "author" references uuid "u-ghost", and authors\/ has no entry carrying it/);
});

test('through the pipeline: the dangling uuid fails the build, and the contracts land beside the manifests', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'vera-cms-ref-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const content = join(root, 'content');
  for (const dir of ['posts', 'authors']) mkdirSync(join(content, dir), { recursive: true });
  writeFileSync(
    join(content, 'schema.json'),
    JSON.stringify({
      version: 1,
      collections: { posts: { fields: { author: { type: 'reference', collection: 'authors' } } }, authors: {} },
    })
  );
  writeFileSync(join(content, 'posts', 'a.md'), '---\nuuid: u1\ntitle: A\nauthor: u-nobody\n---\nx');
  const out = join(root, '_manifests');

  assert.throws(() => buildManifests({ content, out }), /"author" references uuid "u-nobody"/);

  writeFileSync(join(content, 'authors', 'someone.md'), '---\nuuid: u-nobody\ntitle: Someone\n---\nBio.');
  const { written } = buildManifests({ content, out });
  assert.ok(written.some((path) => path.endsWith('posts.schema.json')));
  const contract = JSON.parse(readFileSync(join(out, 'posts.schema.json'), 'utf8'));
  assert.equal(contract.properties.author['x-vera-collection'], 'authors');
});

test('reader.byUuid resolves a reference to its row — the runtime half of the field', async () => {
  globalThis.fetch = async (url) =>
    String(url).endsWith('authors.json')
      ? new Response(JSON.stringify(manifest('authors', [['anon', null, {}], ['someone', 'u-someone', {}]])))
      : new Response('', { status: 404 });
  const reader = createReader();
  const author = await reader.byUuid('authors', 'u-someone');
  assert.equal(author.slug, 'someone');
  assert.equal(await reader.byUuid('authors', 'u-ghost'), null);
  /** A null reference (bare `author:` line) answers null — it once matched the first uuid-less row. */
  assert.equal(await reader.byUuid('authors', null), null);
});
