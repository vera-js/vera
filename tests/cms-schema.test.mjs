/**
 * The schema layer: the file's own validation, the entry validation matrix, and the graded
 * strictness through the real pipeline. The grades ARE the design and each has its own assertion:
 * a violated declaration fails the publish, an unknown field only warns, a missing implicit field
 * only warns — and a schemaless site publishes exactly as if schemas had never been invented.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from './dist.mjs';

const { parseSchema, validateEntry, generateManifest } = await load('cms/publish');
const { buildManifests } = await load('cms/node');

// ── the schema file's own validation ────────────────────────────────────────────────────────────

test('a valid schema parses, with every field kind in it', () => {
  const schema = parseSchema(
    JSON.stringify({
      version: 1,
      collections: {
        posts: {
          fields: {
            date: { type: 'date', required: true },
            views: { type: 'number' },
            featured: { type: 'boolean' },
            summary: { type: 'text' },
            cover: { type: 'image' },
            status: { type: 'select', options: ['draft', 'live'] },
            author: { type: 'reference', collection: 'authors' },
            tags: { type: 'list', of: 'string' },
          },
        },
        nav: { body: false, title: false },
      },
    })
  );
  assert.equal(schema.collections.posts.fields.date.required, true);
  assert.equal(schema.collections.nav.body, false);
});

test('a broken schema fails at load with the path named', () => {
  const bad = (collections, pattern) =>
    assert.throws(() => parseSchema(JSON.stringify({ version: 1, collections })), pattern);
  assert.throws(() => parseSchema('{nope'), /parseSchema: not valid JSON/);
  assert.throws(() => parseSchema('{"version":2,"collections":{}}'), /unknown version 2/);
  bad({ posts: { fields: { x: { type: 'blob' } } } }, /collections\.posts\.fields\.x needs a type/);
  bad({ posts: { fields: { title: { type: 'string' } } } }, /"title" is implicit and cannot be declared/);
  bad({ posts: { fields: { status: { type: 'select', options: [] } } } }, /non-empty options/);
  bad({ posts: { fields: { author: { type: 'reference' } } } }, /needs the collection it points into/);
  bad({ posts: { fields: { tags: { type: 'list', of: 'boolean' } } } }, /holds 'string' or 'number'/);
});

// ── the entry validation matrix ─────────────────────────────────────────────────────────────────

const POSTS = {
  fields: {
    date: { type: 'date', required: true },
    views: { type: 'number' },
    status: { type: 'select', options: ['draft', 'live'] },
    tags: { type: 'list', of: 'string' },
  },
};

test('a conforming entry validates clean', () => {
  const { errors, warnings } = validateEntry(
    { uuid: 'u', title: 'T', date: '2026-09-02', views: 3, status: 'live', tags: ['a'] },
    POSTS
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test('every declared-field violation is an error, with the expectation spelled out', () => {
  const { errors } = validateEntry({ uuid: 'u', title: 'T', date: 'someday', views: 'many', status: 'published', tags: [1] }, POSTS);
  assert.equal(errors.length, 4);
  assert.match(errors[0], /"date": expected a date like 2026-09-02, got "someday"/);
  assert.match(errors[1], /"views": expected a number, got "many"/);
  assert.match(errors[2], /"status": expected one of draft, live/);
  assert.match(errors[3], /"tags": expected a list of strings/);
});

test('missing required is an error; missing optional is nothing; null counts as missing', () => {
  assert.match(validateEntry({ uuid: 'u', title: 'T' }, POSTS).errors[0], /"date" is required and missing/);
  assert.deepEqual(validateEntry({ uuid: 'u', title: 'T', date: '2026-01-01', views: null }, POSTS).errors, []);
});

test('impossible dates are errors — the digit-counting validator once passed 2026-13-99 — audit pass 8', () => {
  for (const bad of ['2026-13-01', '2026-00-10', '2026-01-32', '2026-01-01T25:00', '2026-01-01 10:61'])
    assert.equal(validateEntry({ uuid: 'u', title: 'T', date: bad }, POSTS).errors.length, 1, bad);
  for (const good of ['2026-12-31', '2026-01-01T23:59:59'])
    assert.deepEqual(validateEntry({ uuid: 'u', title: 'T', date: good }, POSTS).errors, [], good);
});

test('unknown fields and a missing title warn — degraded, never broken', () => {
  const { errors, warnings } = validateEntry({ uuid: 'u', date: '2026-01-01', categoreis: ['oops'] }, POSTS);
  assert.deepEqual(errors, []);
  assert.match(warnings[0], /has no title, so listings will show its slug/);
  assert.match(warnings[1], /"categoreis" is not in the schema/);
});

// ── the grades, through the real pipeline ───────────────────────────────────────────────────────

const site = (schema) => {
  const root = mkdtempSync(join(tmpdir(), 'vera-cms-schema-'));
  const posts = join(root, 'content', 'posts');
  mkdirSync(posts, { recursive: true });
  if (schema !== undefined) writeFileSync(join(root, 'content', 'schema.json'), JSON.stringify(schema));
  return { root, posts, content: join(root, 'content'), out: join(root, '_manifests') };
};

const SCHEMA = { version: 1, collections: { posts: { fields: { date: { type: 'date', required: true } } } } };

test('a declared-field violation fails the whole publish, file and field named', (t) => {
  const { root, posts, content, out } = site(SCHEMA);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(posts, 'bad.md'), '---\nuuid: u1\ntitle: T\ndate: tomorrow\n---\nx');
  assert.throws(() => buildManifests({ content, out }), /posts\/bad\.md: "date": expected a date/);
});

test('generateManifest without a spec validates nothing — the schemaless site is untouched', () => {
  const { warnings } = generateManifest('posts', [{ name: 'a.md', text: '---\nuuid: u\nanything: goes\n---\nx' }]);
  assert.deepEqual(warnings, []); // only softness a schemaless build reports is elsewhere (uuid), and this one has one
});

test('folder/schema mismatches warn in both directions', (t) => {
  const { root, content, out } = site({ version: 1, collections: { articles: {} } });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'content', 'posts', 'a.md'), '---\nuuid: u\ntitle: T\n---\nx');
  const { warnings } = buildManifests({ content, out });
  assert.ok(warnings.some((warning) => /"posts" collection is not in the schema/.test(warning)));
  assert.ok(warnings.some((warning) => /schema declares "articles", but content\/ has no such folder/.test(warning)));
});

test('a broken schema file refuses the build — present and wrong is worse than absent', (t) => {
  const { root, content, out } = site();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(content, 'schema.json'), '{broken');
  writeFileSync(join(content, 'posts', 'a.md'), '---\nuuid: u\ntitle: T\n---\nx');
  assert.throws(() => buildManifests({ content, out }), /schema\.json: parseSchema: not valid JSON/);
});

test('a data-only collection with a body warns that it will not render', () => {
  const { warnings } = generateManifest(
    'nav',
    [{ name: 'main.md', text: '---\nuuid: u\nitems: [a, b]\n---\nStray prose.' }],
    { body: false, title: false }
  );
  assert.ok(warnings.some((warning) => /data-only \(body: false\) — it will not render/.test(warning)));
  /** title: false means no missing-title warning either. */
  assert.ok(!warnings.some((warning) => /has no title/.test(warning)));
});
