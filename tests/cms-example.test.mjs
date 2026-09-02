/**
 * The example site, held together: its committed `_manifests/` must be exactly what its `content/`
 * produces (the same-day `--check` rule every committed generated artifact carries — the kitchen
 * fixture drifted for lack of this and the browser suite compared against markup no server
 * emitted), the reader must answer over the real artifacts, and every content file must parse and
 * render — documented content is executed content.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from './dist.mjs';

const { checkManifests, buildManifests } = await load('cms/node');
const { parseContent, serializeHtml, createReader } = await load('cms/content');

const SITE = new URL('../examples/cms-site/', import.meta.url).pathname;
const options = { content: join(SITE, 'content'), out: join(SITE, '_manifests') };

test('the committed manifests are exactly what the content produces', () => {
  assert.deepEqual(checkManifests(options), { stale: [], missing: [], orphaned: [] });
});

test('the example is warning-free — it is what people copy, so it models the full convention', (t) => {
  /** Built to a throwaway out-dir: this asserts the warnings, not the artifacts, and a test never writes into the repo. */
  const out = mkdtempSync(join(tmpdir(), 'vera-cms-example-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const { warnings } = buildManifests({ content: options.content, out });
  assert.deepEqual(warnings, []);
});

test('the reader answers over the real artifacts, served as the page would fetch them', async () => {
  /** The same files the page's `./_manifests/` fetches, handed to fetch by path. */
  globalThis.fetch = async (url) => new Response(readFileSync(join(SITE, String(url))), { status: 200 });
  const reader = createReader({ url: '_manifests/' });

  const posts = await reader.entries('posts', { sort: 'date:desc' });
  assert.deepEqual(posts.map((post) => post.slug), ['on-lists', 'counting-things', 'first-light']);
  assert.ok(posts.every((post) => post.uuid !== null && post.excerpt !== null));

  const about = await reader.entry('pages', 'about');
  assert.equal(about.data.title, 'About');
});

test('every content file parses and renders — the articles the page will fetch all work', () => {
  for (const collection of readdirSync(join(SITE, 'content'), { withFileTypes: true })) {
    if (!collection.isDirectory()) continue;
    for (const name of readdirSync(join(SITE, 'content', collection.name))) {
      const { root, data } = parseContent(readFileSync(join(SITE, 'content', collection.name, name), 'utf8'));
      const html = serializeHtml(root);
      assert.ok(html.length > 0, `${collection.name}/${name} rendered nothing`);
      assert.equal(typeof data.title, 'string', `${collection.name}/${name} has no title`);
    }
  }
});
