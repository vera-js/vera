/**
 * **@verajs/cms's schema and build refusals, by code — words in EVERY build** (code-system phase 5a, 2026-10-09).
 * `publish` and `node` are read by the person who fixes the error (an author in Studio, a build at a terminal), so they
 * are built with `__DEV__` kept true (`words: true`): the production row here asserts the WHOLE sentence too, which is
 * what proves the build kept it. Each line ends with its code. Text an author wrote — a collection name, a field path —
 * arrives JSON-quoted, so a newline or an ANSI sequence in it can neither forge nor hide a log line.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { distUrl, isProduction, load } from './dist.mjs';
import { CMS_REFUSALS, CMS_REJECTIONS, CMS_WRITER_REJECTIONS } from './cms-refusal-cases.mjs';

const { parseSchema } = await load('cms/publish');
const { buildManifests } = await load('cms/node');
const schema = (collections) => JSON.stringify({ version: 1, collections });

for (const [code, run, fragment] of CMS_REFUSALS)
  test(`${code}: the sentence and its code, in every build`, () => {
    assert.throws(run, (error) => {
      assert.ok(error.message.includes(fragment), `the words, in this build too: ${error.message}`);
      assert.ok(error.message.endsWith(`(${code})`), error.message);
      return true;
    });
  });

/** The reader's: `content` keeps its words outside production; in production the subject stays and the link follows it. */
for (const [code, run, fragment] of CMS_REJECTIONS)
  test(`${code}: the subject and the code, in every build — the sentence outside production`, async () => {
    await assert.rejects(run, (error) => {
      assert.ok(error.message.startsWith('createReader: "https://example.com/_manifests/'), `the URL is the subject: ${error.message}`);
      if (isProduction) assert.ok(error.message.endsWith(` — https://verajs.dev/e/${code}`), error.message);
      else assert.ok(error.message.includes(fragment) && error.message.endsWith(`(${code})`), error.message);
      return true;
    });
  });

/** The writer's: `publish` keeps its words in every build, so the sentence is asserted in production too. */
for (const [code, run, fragment] of CMS_WRITER_REJECTIONS)
  test(`${code}: the sentence and its code, in every build`, async () => {
    await assert.rejects(run, (error) => {
      assert.ok(error.message.startsWith('createWriter: ') && error.message.includes(fragment), `the words, in this build too: ${error.message}`);
      assert.ok(error.message.endsWith(`(${code})`), error.message);
      return true;
    });
  });

test('an author-written name arrives quoted: no raw newline, no ANSI sequence', () => {
  assert.throws(() => parseSchema(schema({ 'x\n[vera] fake\u001b[2K': { fields: {} } })), (error) => {
    assert.ok(error.message.endsWith('(cms-schema-collection-name)'), error.message);
    assert.ok(!error.message.includes('\n') && !error.message.includes('\u001b'), `nothing raw: ${error.message}`);
    return true;
  });
});

test('cms-build-reserved-name and cms-build-schema: the build names what it refused, by code', () => {
  const root = mkdtempSync(join(tmpdir(), 'vera-cms-coded-'));
  try {
    const content = join(root, 'content');
    mkdirSync(join(content, 'site'), { recursive: true });
    assert.throws(() => buildManifests({ content, out: join(root, 'out') }), /a collection cannot be named "site"[\s\S]*\(cms-build-reserved-name\)$/);
    rmSync(join(content, 'site'), { recursive: true });
    writeFileSync(join(content, 'schema.json'), '{nope');
    assert.throws(() => buildManifests({ content, out: join(root, 'out') }), (error) => {
      assert.ok(error.message.endsWith('(cms-build-schema)'), error.message);
      assert.ok(error.message.includes(join(content, 'schema.json')), 'the owner\'s own path, whole');
      assert.ok(error.message.includes('(cms-schema-json)'), 'and the schema\'s own refusal carried as it is — its code kept');
      assert.ok(error.cause?.message.endsWith('(cms-schema-json)'), 'its cause');
      return true;
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an entry FILE named with a forged line cannot forge one in the CLI's output", () => {
  const root = mkdtempSync(join(tmpdir(), 'vera-cms-cli-'));
  try {
    const posts = join(root, 'content', 'posts');
    mkdirSync(posts, { recursive: true });
    /** Bad frontmatter, so the build refuses this file BY NAME. */
    writeFileSync(join(posts, 'x\n[vera] fake\u001b[2K.md'), '---\na: {x: 1}\n---\n');
    const cli = spawnSync(process.execPath, [fileURLToPath(distUrl('cms/cli')), `--content=${join(root, 'content')}`, `--out=${join(root, 'out')}`], { encoding: 'utf8' });
    assert.equal(cli.status, 1, 'CONTROL: the build refused the file');
    assert.ok(cli.stderr.includes('(cms-manifest-entry)'), `by code: ${cli.stderr}`);
    const lines = cli.stderr.split('\n');
    assert.ok(!lines.some((line) => line.startsWith('[vera] fake')), `no forged line: ${JSON.stringify(cli.stderr)}`);
    assert.ok(!cli.stderr.includes('\u001b'), 'no ANSI sequence');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
