/**
 * The boundary-hardening family, found by the 2026-09 audit's first pass and pinned here: content-
 * and config-derived names crossing trust boundaries (object keys, repository paths, URL segments,
 * artifact paths) must be bounded at the boundary. Every test here is a proof-of-concept that
 * once succeeded — each one staged a workflow file, ate a field, or crashed a build before its
 * guard existed — plus the legitimate twin the guard must NOT catch, because a bound that
 * over-refuses just moves the defect.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from './dist.mjs';

const { parseFrontmatter, parseSchema, generateTaxonomies, createWriter } = await load('cms/publish');
const { createReader } = await load('cms/content');

const manifest = (collection, rows) => ({
  version: 1,
  collection,
  entries: rows.map(([slug, data]) => ({ slug, uuid: `u-${slug}`, data: { title: slug, ...data }, excerpt: null })),
});

test('__proto__ as a frontmatter key refuses with its line — it once silently ate the field', () => {
  assert.throws(() => parseFrontmatter('---\ntitle: T\n__proto__: x\n---\nb'), /line 3: `__proto__` is not a supported key/);
  /** The refusal must not leak into ordinary keys that merely shadow prototype members. */
  const { data } = parseFrontmatter('---\nconstructor: fine\ntoString: also\n---\nb');
  assert.equal(data.constructor, 'fine');
  assert.equal(data.toString, 'also');
});

test('a term named constructor is content: it counts when real, errors cleanly when dangling — it once crashed', () => {
  const schema = parseSchema(
    JSON.stringify({ version: 1, collections: { posts: { fields: { tags: { type: 'taxonomy', taxonomy: 'tags' } } }, tags: {} } })
  );
  const posts = manifest('posts', [['a', { tags: ['constructor'] }]]);
  const real = generateTaxonomies(schema, new Map([['posts', posts], ['tags', manifest('tags', [['constructor', {}]])]]));
  assert.deepEqual(real.errors, []);
  assert.equal(real.index.taxonomies.tags.constructor.count, 1);
  const dangling = generateTaxonomies(schema, new Map([['posts', posts], ['tags', manifest('tags', [])]]));
  assert.match(dangling.errors[0], /names the term "constructor"/);
});

test('schema names are bounded — they travel into artifact paths and URLs', () => {
  assert.throws(() => parseSchema(JSON.stringify({ version: 1, collections: { '../evil': {} } })), /not a collection name/);
  assert.throws(
    () => parseSchema(JSON.stringify({ version: 1, collections: { posts: { fields: { ['__proto__']: { type: 'string' } } } } })),
    /not a field name/
  );
  assert.throws(
    () => parseSchema(JSON.stringify({ version: 1, collections: { posts: { fields: { constructor: { type: 'string' } } } } })),
    /not a field name/
  );
});

test('a field named constructor in CONTENT reads as unknown, not as inherited machinery', async () => {
  const { validateEntry } = await load('cms/publish');
  const { warnings } = validateEntry({ uuid: 'u', title: 'T', constructor: 'x' }, { fields: {} });
  assert.ok(warnings.some((warning) => /"constructor" is not in the schema/.test(warning)));
});

test('the writer refuses path-shaped names — one once staged a GitHub Actions workflow', () => {
  const writer = createWriter({ repo: 'o/r', token: 't' });
  assert.throws(() => writer.stage('../.github/workflows', 'evil', { data: {}, body: '' }), /not a collection/);
  assert.throws(() => writer.stage('v1.2', 'x', { data: {}, body: '' }), /not a collection/); // dots: slug yes, collection no
  assert.throws(() => writer.stage('posts', '../../evil', { data: {}, body: '' }), /not a slug/);
  assert.throws(() => writer.stageFile('/etc/passwd', 'x'), /not a repository path/);
  assert.throws(() => writer.stageFile('a/../b.md', 'x'), /not a repository path/);
  assert.throws(() => writer.removeFile('.git/config'.replace('.git', '..'), 'x'), /not a repository path/);
  /** The legitimate twins: dotted slugs, nested artifact paths, dotfile-free normal files. */
  writer.stage('posts', 'v1.2-release-notes', { data: { uuid: 'u' }, body: 'x' });
  writer.stageFile('_manifests/posts.json', '{}');
  assert.equal(writer.status().staged.length, 2);
});

test('a taxonomy field cannot NAME __proto__ — the pollution that survived the first fix', () => {
  /**
   * Audit pass 7: `taxonomy: "__proto__"` walked the inherited-lookup existence check and seeded
   * term records onto Object.prototype itself — globally, with the build green. The schema now
   * refuses the VALUE like a name; and even unrefused, both index levels are null-prototype.
   */
  assert.throws(
    () => parseSchema(JSON.stringify({ version: 1, collections: { posts: { fields: { tags: { type: 'taxonomy', taxonomy: '__proto__' } } } } })),
    /a taxonomy field names its term collection/
  );
  /** `toString` passes the name shape but fails the OWN-KEY existence check — the inherited lookup was the hole. */
  assert.throws(
    () => parseSchema(JSON.stringify({ version: 1, collections: { posts: { fields: { tags: { type: 'taxonomy', taxonomy: 'toString' } } } } })),
    /not a declared collection/
  );
  assert.throws(
    () => parseSchema(JSON.stringify({ version: 1, collections: { posts: { fields: { by: { type: 'reference', collection: '__proto__' } } } } })),
    /a reference needs the collection/
  );
  assert.equal({}.pwn, undefined, 'Object.prototype must be clean after everything this file ran');
});

test('collections cannot take generated-artifact names — site once lost its manifest to the index', () => {
  assert.throws(() => parseSchema(JSON.stringify({ version: 1, collections: { site: {} } })), /not a collection name/);
  assert.throws(() => parseSchema(JSON.stringify({ version: 1, collections: { taxonomies: {} } })), /not a collection name/);
});

test('the write boundary refuses what the parser cannot read back', async () => {
  const { serializeContent } = await load('cms/publish');
  /** Key injection: a crafted field NAME serialized verbatim would parse back as three fields. */
  assert.throws(() => serializeContent({ ['title: t\nuuid: x']: 'v' }, 'b'), /not a writable key/);
  assert.throws(() => serializeContent({ ['__proto__']: 'v' }, 'b'), /not a writable key/);
  /** No line-break escape exists in the subset — committed, these would brick every later build. */
  assert.throws(() => serializeContent({ title: 'a\nb' }, 'b'), /multiline strings are not writable/);
  assert.throws(() => serializeContent({ title: 'a\u2028b' }, 'b'), /multiline strings are not writable/);
  assert.throws(() => serializeContent({ n: NaN }, 'b'), /not a writable number/);
  assert.throws(() => serializeContent({ n: 1e21 }, 'b'), /not a writable number/);
  assert.throws(() => serializeContent({ empty: {} }, 'b'), /empty map/);
  assert.throws(() => serializeContent({ weird: [[1, 2]] }, 'b'), /not writable/);
  /** A body OPENING with --- must not be promoted to frontmatter on the round trip. */
  const text = serializeContent({}, '---\nuuid: from-body\n---\nrest');
  assert.deepEqual(parseFrontmatter(text), { data: {}, body: '---\nuuid: from-body\n---\nrest' });
  const hrBody = serializeContent({}, '---\n\nafter a break\n');
  assert.deepEqual(parseFrontmatter(hrBody).body, '---\n\nafter a break\n');
});

test('pathological inputs are refused by name or merely slow — never a crash', async () => {
  const { parseMarkdown } = await load('cms/publish');
  /** Deep nesting once threw RangeError from the recursion itself. (`- - - …` on one line is now
   * correctly a thematic break, so the modern repro nests for real, two spaces at a time.) */
  const deepList = Array.from({ length: 80 }, (_, i) => '  '.repeat(i) + '- x').join('\n');
  assert.throws(() => parseMarkdown(deepList), /nesting deeper than 64/);
  assert.throws(() => parseMarkdown('>'.repeat(20000) + ' x'), /nesting deeper than 64/);
  assert.throws(
    () => parseFrontmatter('---\n' + Array.from({ length: 40 }, (_, i) => '  '.repeat(i) + 'k:').join('\n') + '\n---\nb'),
    /nesting deeper than 32/
  );
  /** The FENCE regex was quadratic; 40k chars on one line must parse in linear-ish time. */
  const start = performance.now();
  parseMarkdown('```' + 'a'.repeat(40000) + ' `x');
  assert.ok(performance.now() - start < 1000, 'the fence line must not take seconds');
});

test('the three copies of the collection-name rule agree — schema, writer, reader in lockstep', async () => {
  /**
   * The rule is deliberately duplicated (three bundles, no shared runtime); this is the executable
   * check that keeps the copies from drifting: every probe name must get the same verdict from all
   * three surfaces, or a name one accepts becomes a name another refuses at a worse moment.
   */
  const writer = createWriter({ repo: 'o/r', token: 't' });
  globalThis.fetch = async () => new Response(JSON.stringify({ version: 1, collection: 'x', entries: [] }));
  const reader = createReader();
  const PROBES = ['posts', 'a1', '2024-notes', 'a_b', '../evil', 'a/b', 'a.b', 'v1.2', '', '-lead', '_lead', 'constructor', 'prototype', 'site', 'taxonomies', 'café'];
  for (const name of PROBES) {
    const bySchema = (() => { try { parseSchema(JSON.stringify({ version: 1, collections: { [name]: {} } })); return true; } catch { return false; } })();
    const byWriter = (() => { try { writer.stage(name, 'slug', { data: {}, body: '' }); writer.discard(); return true; } catch { return false; } })();
    const byReader = await reader.entries(name).then(() => true, (error) => !/not a collection name/.test(error.message));
    assert.equal(bySchema, byWriter, `schema and writer disagree about ${JSON.stringify(name)}`);
    assert.equal(bySchema, byReader, `schema and reader disagree about ${JSON.stringify(name)}`);
  }
});

test('the reader refuses a path-shaped collection before it becomes a URL', async () => {
  globalThis.fetch = async () => new Response('{}', { status: 200 });
  const reader = createReader();
  await assert.rejects(reader.entries('../secrets'), /not a collection name/);
  await assert.rejects(reader.entry('a/b', 'x'), /not a collection name/);
});
