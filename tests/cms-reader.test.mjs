/**
 * The query core and the reader over it. The load-bearing assertions: nullish sorts last in BOTH
 * directions (the first draft flipped it with the sign and would have crowned undated entries
 * under `date:desc`), sorting never uses the machine's locale, the cache dedupes concurrent loads
 * without caching failures, and multi-collection rows say where they came from.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from './dist.mjs';

const { queryEntries, createReader } = await load('cms/content');

const row = (slug, data = {}) => ({ slug, uuid: null, data, excerpt: null });

const POSTS = [
  row('beta', { date: '2026-02-01', views: 20, tags: ['b'] }),
  row('alpha', { date: '2026-03-01', views: 3 }),
  row('gamma', { views: 100 }), // no date — must trail every dated entry, both directions
  row('delta', { date: '2026-01-15', views: 20 }),
];

// ── the pure core ───────────────────────────────────────────────────────────────────────────────

test('filter, sort desc, offset and limit compose — and inputs are never reordered in place', () => {
  const before = [...POSTS];
  const page = queryEntries(POSTS, { filter: (e) => e.data.views >= 3, sort: 'date:desc', offset: 1, limit: 2 });
  assert.deepEqual(page.map((e) => e.slug), ['beta', 'delta']);
  assert.deepEqual(POSTS, before);
});

test('an entry missing the sort field trails in BOTH directions', () => {
  assert.deepEqual(queryEntries(POSTS, { sort: 'date' }).map((e) => e.slug), ['delta', 'beta', 'alpha', 'gamma']);
  assert.deepEqual(queryEntries(POSTS, { sort: 'date:desc' }).map((e) => e.slug), ['alpha', 'beta', 'delta', 'gamma']);
});

test('numbers sort numerically, not as strings', () => {
  assert.deepEqual(queryEntries(POSTS, { sort: 'views' }).map((e) => e.data.views), [3, 20, 20, 100]);
});

test('equal keys tie-break by slug, so pagination never sees an unstable order', () => {
  assert.deepEqual(
    queryEntries(POSTS, { filter: (e) => e.data.views === 20, sort: 'views' }).map((e) => e.slug),
    ['beta', 'delta']
  );
});

test('sorting by a row field needs no special spelling', () => {
  assert.deepEqual(queryEntries(POSTS, { sort: 'slug' }).map((e) => e.slug), ['alpha', 'beta', 'delta', 'gamma']);
});

test('no options returns a copy in given order', () => {
  const copied = queryEntries(POSTS);
  assert.deepEqual(copied, POSTS);
  assert.notEqual(copied, POSTS);
});

// ── the reader ──────────────────────────────────────────────────────────────────────────────────

/** A fetch that serves fixture manifests and counts requests — the reader sees a real Response. */
const serve = (manifests) => {
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    const name = String(url).match(/\/([^/]+)\.json$/)?.[1];
    const manifest = manifests[name];
    if (manifest === undefined) return new Response('nope', { status: 404 });
    return new Response(JSON.stringify(manifest), { status: 200 });
  };
  return requests;
};

const MANIFESTS = {
  posts: { version: 1, collection: 'posts', entries: [row('hello', { date: '2026-01-01' }), row('world', { date: '2026-02-01' })] },
  notes: { version: 1, collection: 'notes', entries: [row('aside', { date: '2026-01-15' })] },
};

test('entry answers by address, and a missing entry is null, not an error', async () => {
  serve(MANIFESTS);
  const site = createReader();
  assert.equal((await site.entry('posts', 'hello')).data.date, '2026-01-01');
  assert.equal(await site.entry('posts', 'nope'), null);
});

test('entries takes one collection or several, and every row says where it came from', async () => {
  serve(MANIFESTS);
  const site = createReader();
  const feed = await site.entries(['posts', 'notes'], { sort: 'date:desc' });
  assert.deepEqual(
    feed.map((e) => `${e.collection}/${e.slug}`),
    ['posts/world', 'notes/aside', 'posts/hello']
  );
  assert.equal((await site.entries('notes'))[0].collection, 'notes');
});

test('concurrent queries share one request per collection — the promise is cached, not the result', async () => {
  const requests = serve(MANIFESTS);
  const site = createReader();
  await Promise.all([site.entries('posts'), site.entry('posts', 'hello'), site.entries(['posts', 'notes'])]);
  assert.deepEqual(requests, ['/_manifests/posts.json', '/_manifests/notes.json']);
});

test('a failed load names the collection, the status and the URL — and is not cached', async () => {
  const requests = serve(MANIFESTS);
  const site = createReader({ url: 'https://example.com/_manifests/' });
  await assert.rejects(site.entries('missing'), /createReader: .*"missing".*HTTP 404.*https:\/\/example\.com\/_manifests\/missing\.json/);
  await assert.rejects(site.entries('missing'), /HTTP 404/);
  assert.equal(requests.length, 2); // the second attempt really refetched
});

test('the writer is not here — a reader can only ever read', async () => {
  const content = await load('cms/content');
  assert.equal(content.createWriter, undefined);
});
