/**
 * **Every cms schema, manifest and build refusal as a runnable case** — one list, read by tests/cms-coded-errors
 * (each sentence and code, in both builds) and by tests/api-misuse-sweep (every `misuse()` code in the tree is thrown by
 * a case it can run), so the two can never cover different sets. Each case: [code, run, a fragment of its sentence].
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from './dist.mjs';

const { parseSchema, generateManifest, parseFrontmatter, parseMarkdown } = await load('cms/publish');
const { buildManifests } = await load('cms/node');
const { createReader } = await load('cms/content');

const schema = (collections) => JSON.stringify({ version: 1, collections });
const parse = (text) => () => parseSchema(text);

/** A build over a throwaway content directory: `files` maps a relative path to its text. */
const build = (files) => () => {
  const root = mkdtempSync(join(tmpdir(), 'vera-cms-case-'));
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, 'content', path, '..'), { recursive: true });
      if (text !== null) writeFileSync(join(root, 'content', path), text);
    }
    buildManifests({ content: join(root, 'content'), out: join(root, 'out') });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

export const CMS_REFUSALS = [
  /** Frontmatter and markdown through `publish`, whose words are kept in every build (content's are development's). */
  ['cms-frontmatter-unclosed', () => parseFrontmatter('---\ntitle: x\n'), 'the opening --- never closes'],
  ['cms-frontmatter-unsupported', () => parseFrontmatter('---\nbody: |\n---\n'), 'block scalars (|) are not supported'],
  ['cms-frontmatter-indent', () => parseFrontmatter('---\n a: 1\n---\n'), 'expected 0-space indentation'],
  ['cms-frontmatter-entry', () => parseFrontmatter('---\njust words\n---\n'), 'expected `key: value`'],
  ['cms-frontmatter-key', () => parseFrontmatter('---\ntitle: a\ntitle: b\n---\n'), 'the key "title" is a duplicate'],
  ['cms-frontmatter-mixed-list', () => parseFrontmatter('---\nxs:\n  - a\n  - k: v\n---\n'), 'a list mixes scalar and map items'],
  ['cms-frontmatter-depth', () => parseFrontmatter('---\n' + Array.from({ length: 40 }, (_, i) => '  '.repeat(i) + 'k:').join('\n') + '\n---\n'), 'nesting deeper than 32 levels'],
  ['cms-markdown-depth', () => parseMarkdown('>'.repeat(100) + ' x'), 'nesting deeper than 64 levels'],
  ['cms-schema-json', parse('{nope'), 'not valid JSON'],
  ['cms-schema-not-object', parse('null'), 'expected an object'],
  ['cms-schema-version', parse('{"version":3,"collections":{}}'), 'unknown version "3"'],
  ['cms-schema-collections', parse('{"version":1}'), 'expected a collections object'],
  ['cms-schema-collection-name', parse(schema({ 'bad name': { fields: {} } })), '"bad name" is not a collection name'],
  ['cms-schema-collection-shape', parse(schema({ posts: 5 })), '"collections.posts" must be an object'],
  ['cms-schema-field-type', parse(schema({ posts: { fields: { x: { type: 'blob' } } } })), 'needs a type from'],
  ['cms-schema-implicit-field', parse(schema({ posts: { fields: { slug: { type: 'string' } } } })), '"slug" is implicit'],
  ['cms-schema-field-name', parse(schema({ posts: { fields: { 'bad name': { type: 'string' } } } })), 'not a field name'],
  ['cms-schema-select-options', parse(schema({ posts: { fields: { s: { type: 'select', options: [] } } } })), 'non-empty options'],
  ['cms-schema-reference', parse(schema({ posts: { fields: { a: { type: 'reference' } } } })), 'needs the collection it points into'],
  ['cms-schema-list-type', parse(schema({ posts: { fields: { t: { type: 'list', of: 'boolean' } } } })), "holds 'string' or 'number'"],
  ['cms-schema-taxonomy', parse(schema({ posts: { fields: { t: { type: 'taxonomy' } } } })), 'names its term collection'],
  ['cms-schema-taxonomy-missing', parse(schema({ posts: { fields: { t: { type: 'taxonomy', taxonomy: 'tags' } } } })), 'points at taxonomy "tags"'],
  ['cms-manifest-entry', () => generateManifest('posts', [{ name: 'bad.md', text: '---\na: {x: 1}\n---\n' }]), '"posts/bad.md" could not be read'],
  ['cms-manifest-invalid', () => generateManifest('posts', [{ name: 'p.md', text: '---\ntitle: P\n---\n' }], { fields: { date: { type: 'date', required: true } } }), 'has fields that do not match the schema'],
  ['cms-build-schema', build({ 'schema.json': '{nope' }), 'is not a usable schema'],
  ['cms-build-reserved-name', build({ 'site/.keep': '' }), 'a collection cannot be named "site"'],
  ['cms-build-errors', build({
    'schema.json': schema({ posts: { fields: { tags: { type: 'taxonomy', taxonomy: 'tags' } } }, tags: { fields: {} } }),
    'posts/p.md': '---\ntitle: P\ntags: [nope]\n---\n',
    'tags/.keep': '',
  }), 'problem(s) across the content'],
];

/**
 * The reader's refusals REJECT — a failed load is async — and come from `content`, a visitor's bundle whose words are
 * development's: production prints `createReader: "<url>" (HTTP <status>) — https://verajs.dev/e/<code>`, so these
 * assert the sentence outside production only. Each: [code, run, a fragment of its sentence]. `fetch` is faked for the
 * one call and restored, whatever happens.
 */
const failing = (status, read) => async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status });
  try {
    await read(createReader({ url: 'https://example.com/_manifests/' }));
  } finally {
    globalThis.fetch = saved;
  }
};

export const CMS_REJECTIONS = [
  ['cms-reader-manifest', failing(404, (reader) => reader.entries('posts')), 'could not load the "posts" manifest'],
  ['cms-reader-taxonomy', failing(500, (reader) => reader.terms('tags')), 'could not load the taxonomy index'],
];
