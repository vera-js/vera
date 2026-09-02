/**
 * The write half. Two load-bearing suites: the ROUND TRIP — `parseFrontmatter(serializeContent(x))`
 * must give back exactly `x`, across every shape the subset can hold, or tooling-written files are
 * lies — and the WORKSPACE against a faked Git Data API, asserting the things the wp-omni pattern
 * exists for: one atomic delta commit, removals as null shas, a moved head refused with the staged
 * work kept, and force never sent.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from './dist.mjs';

const { serializeContent, createWriter, parseFrontmatter } = await load('cms/publish');

// ── the round trip ──────────────────────────────────────────────────────────────────────────────

const SHAPES = [
  { title: 'Plain Title', count: 3, rate: -1.5, live: true, off: false, nothing: null },
  { tricky: ['a, b', 'c'], tags: ['x', 'y'], numbers: [1, 2], empty: [] },
  { quoteMe: 'true', alsoMe: '42', dash: '- starts with dash', hash: '# not a comment', amp: '&anchor' },
  { spacey: '  padded  ', quoted: 'say "hi" \\ there', colon: 'a: b' },
  { bothInArray: ['say "hi", friend', 'plain'] }, // quote AND comma in one item — audit pass 2
  { midQuote: ["it's", 'b'] }, // a bare apostrophe once derailed the splitter and merged items — audit pass 8
  { nav: [{ label: 'Home', url: '/' }, { label: 'About', url: '/about' }] },
  { seo: { title: 'Nested', image: { url: '/og.png', width: 1200 } } },
  { uuid: '018f3a2e-0001-7000-8000-000000000001', date: '2026-09-02' },
];

for (const data of SHAPES) {
  test(`round trip: ${Object.keys(data).join(', ')}`, () => {
    const text = serializeContent(data, 'The body.\n');
    const back = parseFrontmatter(text);
    assert.deepEqual(back.data, data);
    assert.equal(back.body, 'The body.\n');
  });
}

test('empty data writes no fence; the body is the file', () => {
  assert.equal(serializeContent({}, '# Just markdown'), '# Just markdown');
});

// ── the faked API ───────────────────────────────────────────────────────────────────────────────

/**
 * Enough GitHub to hold the writer honest: refs, blobs, trees (with base_tree delta semantics),
 * commits. `moveHead()` is the other editor — the concurrent commit the no-force rule protects.
 */
const fakeGithub = () => {
  const store = {
    head: 'c0',
    commits: { c0: { tree: 't0' } },
    trees: { t0: { 'content/posts/existing.md': 'b-existing' } },
    blobs: { 'b-existing': 'old text' },
    requests: [],
    nextId: 1,
  };
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const path = String(url).replace('https://api.github.com/repos/owner/site', '');
    store.requests.push(`${method} ${path.split('/').slice(0, 3).join('/')}`);
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    const answer = (json, status = 200) => new Response(JSON.stringify(json), { status });

    if (method === 'GET' && path === '/git/ref/heads/main') return answer({ object: { sha: store.head } });
    if (method === 'GET' && path.startsWith('/git/commits/')) {
      const commit = store.commits[path.split('/').pop()];
      return commit ? answer({ tree: { sha: commit.tree } }) : answer({}, 404);
    }
    if (method === 'POST' && path === '/git/blobs') {
      const sha = `b${store.nextId++}`;
      store.blobs[sha] = body.content;
      return answer({ sha });
    }
    if (method === 'POST' && path === '/git/trees') {
      const sha = `t${store.nextId++}`;
      const files = { ...store.trees[body.base_tree] };
      for (const entry of body.tree) {
        if (entry.sha === null) delete files[entry.path];
        else files[entry.path] = entry.sha;
      }
      store.trees[sha] = files;
      return answer({ sha });
    }
    if (method === 'POST' && path === '/git/commits') {
      const sha = `c${store.nextId++}`;
      store.commits[sha] = { tree: body.tree, parents: body.parents, message: body.message };
      return answer({ sha });
    }
    if (method === 'PATCH' && path === '/git/refs/heads/main') {
      if (body.force === true) throw new Error('THE WRITER SENT FORCE');
      /** Fast-forward only: the new commit's parent must be where the head stands. */
      if (store.commits[body.sha].parents[0] !== store.head) return answer({ message: 'not a fast forward' }, 422);
      store.head = body.sha;
      return answer({ object: { sha: body.sha } });
    }
    return answer({ message: `unfaked: ${method} ${path}` }, 500);
  };
  return store;
};

const writer = () => createWriter({ repo: 'owner/site', token: 't' });

test('everything staged lands as ONE commit with a delta tree — untouched files ride through', async (t) => {
  const github = fakeGithub();
  const site = writer();
  await site.open();
  site.stage('posts', 'hello', { data: { uuid: 'u1', title: 'Hello' }, body: 'Hi.\n' });
  site.stageFile('_manifests/posts.json', '{"regenerated":true}\n');
  site.remove('posts', 'existing');

  const { commit } = await site.publish({ message: 'publish: hello' });
  assert.equal(github.head, commit);
  const tree = github.trees[github.commits[commit].tree];
  assert.equal(github.blobs[tree['content/posts/hello.md']], '---\nuuid: u1\ntitle: Hello\n---\nHi.\n');
  assert.equal(tree['_manifests/posts.json'] !== undefined, true);
  assert.equal(tree['content/posts/existing.md'], undefined, 'the removal must delete via a null sha');
  assert.equal(github.requests.filter((line) => line.startsWith('POST /git/commits')).length, 1);
  t.diagnostic(`requests: ${github.requests.length}`);
});

test('a uuid that is null gets a fresh identity — the spread once let null clobber it — audit pass 8', () => {
  fakeGithub();
  const site = writer();
  site.stage('posts', 'bare', { data: { uuid: null, title: 'Bare' }, body: 'x' });
  assert.match(site.status().staged[0].text, /^---\nuuid: [0-9a-f-]{36}\n/);
});

test('removing a file the branch never had is named, not a raw 422 — audit pass 8', async () => {
  const github = fakeGithub();
  /** The fake refuses a delta that deletes an unknown path, as the real trees API does. */
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (init?.method === 'POST' && String(url).endsWith('/git/trees')) {
      const body = JSON.parse(init.body);
      const base = github.trees[body.base_tree];
      if (body.tree.some((entry) => entry.sha === null && base[entry.path] === undefined))
        return new Response('{"message":"tree entry not found"}', { status: 422 });
    }
    return previousFetch(url, init);
  };
  const site = writer();
  await site.open();
  site.remove('posts', 'never-existed');
  await assert.rejects(site.publish({ message: 'm' }), /usual cause is a staged removal naming a file/);
  assert.equal(site.status().staged.length, 1, 'everything staged is kept, as the message promises');
});

test('a new entry gets a uuid at creation; an edit keeps the one it has', () => {
  fakeGithub();
  const site = writer();
  site.stage('posts', 'fresh', { data: { title: 'Fresh' }, body: 'x' });
  site.stage('posts', 'edited', { data: { uuid: 'u-keep', title: 'Edited' }, body: 'x' });
  const staged = Object.fromEntries(site.status().staged.map(({ path, text }) => [path, text]));
  assert.match(staged['content/posts/fresh.md'], /^---\nuuid: [0-9a-f-]{36}\n/);
  assert.match(staged['content/posts/edited.md'], /^---\nuuid: u-keep\n/);
});

test('a moved head is refused, named honestly, staged work kept — and re-open publishes it', async () => {
  const github = fakeGithub();
  const site = writer();
  await site.open();
  site.stage('posts', 'mine', { data: { uuid: 'u1', title: 'Mine' }, body: 'x' });

  /** The other editor lands a commit after this session pinned. */
  github.commits.c99 = { tree: 't0', parents: [github.head] };
  github.head = 'c99';

  await assert.rejects(site.publish({ message: 'race' }), /"main" moved ahead.*Nothing was lost.*staged changes are kept/s);
  assert.equal(site.status().staged.length, 1, 'the overlay must survive the refusal');

  await site.open();
  const { commit } = await site.publish({ message: 'retry' });
  assert.equal(github.head, commit);
  assert.deepEqual(github.commits[commit].parents, ['c99'], 'the retry parents on the NEWER head');
  assert.equal(site.status().staged.length, 0);
});

test('publish without open() refuses with instructions; publish with nothing staged refuses too', async () => {
  fakeGithub();
  const site = writer();
  site.stage('posts', 'a', { data: { uuid: 'u' }, body: 'x' });
  await assert.rejects(site.publish({ message: 'm' }), /open\(\) first/);
  await site.open();
  site.discard();
  await assert.rejects(site.publish({ message: 'm' }), /nothing is staged/);
});

test('discard drops one path or everything; status reports removals as null', () => {
  fakeGithub();
  const site = writer();
  site.stage('posts', 'keep', { data: { uuid: 'u1' }, body: 'x' });
  site.stage('posts', 'drop', { data: { uuid: 'u2' }, body: 'x' });
  site.removeFile('old.txt');
  site.discard('content/posts/drop.md');
  const staged = site.status().staged;
  assert.deepEqual(staged.map(({ path }) => path), ['content/posts/keep.md', 'old.txt']);
  assert.equal(staged[1].text, null);
});

test('the reader entry does not carry the writer — a deployed site structurally cannot commit', async () => {
  const content = await load('cms/content');
  assert.equal(content.createWriter, undefined);
  assert.equal(content.serializeContent, undefined);
});
