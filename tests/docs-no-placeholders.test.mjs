/**
 * **No public doc ships a placeholder** (2026-11-21): `@verajs/ssr`'s Performance table read `**PERF**` in every cell, and
 * "a 100-row table here is PERF_TABLE µs", on npm and GitHub from 2026-09-28 until a bench run filled them. Every tracked
 * Markdown file and `llms.txt` is read, changesets included (they become the changelog); the changelogs themselves are
 * history and are skipped. The tokens are the upper-case placeholders a draft leaves (`PERF`, `PERF_…`, `TBD`, `FIXME`,
 * `XXX`), matched as whole words and case-sensitively, so prose such as "the TODO list" is not one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const PLACEHOLDER = /\b(?:PERF(?:_[A-Z0-9]+)*|TBD|FIXME|XXX)\b/g;
/** Every placeholder in `text`, as `file:line: token`. */
const placeholdersIn = (file, text) =>
  text.split('\n').flatMap((line, i) => [...line.matchAll(PLACEHOLDER)].map((match) => `${file}:${i + 1}: ${match[0]}`));

test('the matcher: each placeholder form is found, and ordinary words are not (CONTROL)', () => {
  assert.deepEqual(placeholdersIn('a.md', '| **PERF** | x |\nis PERF_TABLE µs\nTBD and FIXME and XXX'), [
    'a.md:1: PERF', 'a.md:2: PERF_TABLE', 'a.md:3: TBD', 'a.md:3: FIXME', 'a.md:3: XXX',
  ]);
  assert.deepEqual(placeholdersIn('a.md', 'performance, the TODO list, PERFORMANCE, perf, XXXL, a TBDx'), []);
});

test('no tracked Markdown file or llms.txt holds a placeholder', () => {
  const files = execFileSync('git', ['ls-files', '*.md', 'llms.txt'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((file) => file && !file.endsWith('CHANGELOG.md'));
  assert.ok(files.length >= 50, `a floor on the docs read (62 on 2026-11-21): ${files.length}`);
  assert.ok(files.includes('packages/ssr/README.md') && files.includes('llms.txt'), 'CONTROL: the file that shipped the placeholders is read');
  assert.deepEqual(files.flatMap((file) => placeholdersIn(file, readFileSync(new URL(file, ROOT), 'utf8'))), []);
});
