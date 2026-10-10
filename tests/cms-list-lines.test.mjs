/**
 * **cms's list lines — validation errors, build warnings — each end on its code, in every build** (code-system phase
 * 5a-lists, vera-5a, 2026-10-09). These are pushed onto lists (a manifest's errors, the build's warnings, the CLI's
 * stderr) rather than thrown, so api-misuse-sweep does not reach them; this does. Each line leads with its subject (the
 * field, the file or the collection, quoted) and ends with its code, and a value an author wrote arrives quoted: a
 * newline or an ANSI sequence in it can neither forge nor hide a line. `publish` and `node` keep their words in every
 * build, so the production row asserts the sentence too.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from './dist.mjs';

const { parseSchema, validateEntry, generateManifest, checkReferences, generateTaxonomies } = await load('cms/publish');
const { buildManifests } = await load('cms/node');

const endsOn = (line, code, fragment) => {
  assert.ok(line.endsWith(`(${code})`), `ends on its code: ${line}`);
  assert.ok(line.includes(fragment), `the words, in this build too: ${line}`);
};

test('validateEntry: required, value, untitled and unknown-field — each line its own code', () => {
  const spec = { title: true, fields: { date: { type: 'date', required: true }, views: { type: 'number' } } };
  const { errors, warnings } = validateEntry({ views: 'many', extra: 1 }, spec);
  endsOn(errors.find((line) => line.startsWith('"date"')), 'cms-entry-required', 'this required field is missing');
  endsOn(errors.find((line) => line.startsWith('"views"')), 'cms-entry-value', 'expected a number, got "many"');
  endsOn(warnings.find((line) => line.startsWith('"title"')), 'cms-entry-untitled', 'listings will show its slug');
  endsOn(warnings.find((line) => line.startsWith('"extra"')), 'cms-entry-unknown-field', 'not in the schema');
});

test('an author-written value and field name arrive quoted: no raw newline, no ANSI sequence', () => {
  const { errors, warnings } = validateEntry({ views: 'x\n[vera] fake\u001b[2K', 'bad\nkey': 1 }, { title: false, fields: { views: { type: 'number' } } });
  for (const line of [...errors, ...warnings]) assert.ok(!line.includes('\n') && !line.includes('\u001b'), `nothing raw: ${JSON.stringify(line)}`);
  assert.ok(errors.length === 1 && warnings.length === 1, 'CONTROL: both lines were produced');
});

test('generateManifest: body-unused and no-uuid lead with the file', () => {
  const { warnings } = generateManifest('notes', [{ name: 'n.md', text: '---\ntitle: N\n---\nprose' }], { body: false, fields: {} });
  endsOn(warnings.find((line) => line.includes('cms-entry-body-unused')), 'cms-entry-body-unused', '"notes/n.md": the entry has a body');
  endsOn(warnings.find((line) => line.includes('cms-entry-no-uuid')), 'cms-entry-no-uuid', '"notes/n.md": the entry has no uuid');
});

test('checkReferences and generateTaxonomies: a dangling reference and an unknown term, by code', () => {
  const schema = parseSchema(JSON.stringify({ version: 1, collections: {
    posts: { fields: { author: { type: 'reference', collection: 'people' }, tags: { type: 'taxonomy', taxonomy: 'tags' } } },
    people: { fields: {} }, tags: { fields: {} },
  } }));
  const manifests = new Map([
    ['posts', generateManifest('posts', [{ name: 'p.md', text: '---\nuuid: u1\ntitle: P\nauthor: ghost\ntags: [nope]\n---\n' }], schema.collections.posts).manifest],
    ['people', generateManifest('people', [], schema.collections.people).manifest],
    ['tags', generateManifest('tags', [], schema.collections.tags).manifest],
  ]);
  endsOn(checkReferences(schema, manifests)[0], 'cms-entry-dangling-reference', '"author" references uuid "ghost"');
  endsOn(generateTaxonomies(schema, manifests).errors[0], 'cms-entry-unknown-term', 'or create "tags/nope.md"');
});

test('buildManifests: unknown-collection and missing-folder, by code', () => {
  const root = mkdtempSync(join(tmpdir(), 'vera-cms-lists-'));
  try {
    const content = join(root, 'content');
    mkdirSync(join(content, 'posts'), { recursive: true });
    writeFileSync(join(content, 'posts', 'a.md'), '---\nuuid: u\ntitle: T\n---\nx');
    writeFileSync(join(content, 'schema.json'), JSON.stringify({ version: 1, collections: { articles: {} } }));
    const { warnings } = buildManifests({ content, out: join(root, 'out') });
    endsOn(warnings.find((line) => line.startsWith('"posts"')), 'cms-build-unknown-collection', 'not in the schema');
    endsOn(warnings.find((line) => line.startsWith('"articles"')), 'cms-build-missing-folder', 'has no such folder');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
