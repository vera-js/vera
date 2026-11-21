/**
 * **A suite reads code without its comments through `withoutComments` only** (2026-11-20). A regex stripper takes a
 * `/*` inside a string, a template or a regex for an opener and deletes the code up to the next comment's close, so a
 * check that looks there sees nothing. Every file under tests/ and scripts/ is read with its own comments blanked, so a
 * stripper named in prose is allowed and one written as code is refused.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { comments, withoutComments } from './source-comments.mjs';

/** The regex sources a comment stripper is spelled with, written with doubled backslashes so this file holds none. */
const SPELLINGS = ['\\/\\*[\\s\\S]*?\\*\\/', '\\/\\/.*$', '\\/\\/[^\\n]*'];

/** Each `file:line: spelling` in `text` once its comments are blanked. */
const strippers = (file, text) => {
  const code = withoutComments(text, file);
  const found = [];
  for (const spelling of SPELLINGS) {
    for (let at = code.indexOf(spelling); at !== -1; at = code.indexOf(spelling, at + 1)) {
      found.push(`${file}:${code.slice(0, at).split('\n').length}: ${spelling}`);
    }
  }
  return found;
};

const corpus = execFileSync('git', ['ls-files', '--', 'tests', 'scripts'], { encoding: 'utf8' })
  .split('\n')
  .filter((file) => /\.(?:[cm]?js|ts)$/.test(file));

test('no file under tests/ or scripts/ strips comments with a regex', () => {
  assert.ok(corpus.length >= 800, `the corpus read ${corpus.length} files; the walk is broken`);
  assert.deepEqual(corpus.flatMap((file) => strippers(file, readFileSync(file, 'utf8'))), []);
});

test('the guard refuses each spelling in code and allows it in a comment (planted)', () => {
  const block = ".replace(/\\/\\*[\\s\\S]*?\\*\\//g, '')";
  const line = ".replace(/^\\s*\\/\\/.*$/gm, '')";
  const bare = ".replace(/\\/\\/[^\\n]*/g, '')";
  assert.deepEqual(strippers('x.mjs', `const a = 1;\nconst b = (t) => t${block};`), [`x.mjs:2: ${SPELLINGS[0]}`]);
  assert.deepEqual(strippers('x.mjs', `const b = (t) => t${line};`), [`x.mjs:1: ${SPELLINGS[1]}`]);
  assert.deepEqual(strippers('x.mjs', `const b = (t) => t${bare};`), [`x.mjs:1: ${SPELLINGS[2]}`]);
  assert.deepEqual(strippers('x.mjs', `// t${block}${line}\n/* t${bare} */\nconst c = 1;`), []);
});

test('withoutComments keeps a comment opener inside a string, a template and a regex, and every offset', () => {
  const text = "const s = '/* not a comment';\nconst t = `//${s}`; // gone\nconst r = /\\/*x/; /* gone */ const z = 1;\n";
  const code = withoutComments(text, 'x.mjs');
  assert.equal(code.length, text.length);
  assert.equal(code.split('\n').length, text.split('\n').length);
  for (const kept of ["'/* not a comment'", '`//${s}`', '/\\/*x/', 'const z = 1;']) assert.ok(code.includes(kept), kept);
  assert.ok(!code.includes('gone'));
  // The control: the regex stripper this replaces deletes the code between the string's `/*` and the comment's close.
  assert.ok(!text.replace(new RegExp(SPELLINGS[0], 'g'), '').includes('const r'));
});

test('withoutComments parses a file by its name: JSX in a .jsx file, a cast in a .ts file', () => {
  assert.equal(withoutComments('const a = <b>{/* c */}</b>;', 'x.jsx'), 'const a = <b>{       }</b>;');
  assert.equal(withoutComments('const a = <B>c; // d', 'x.ts'), 'const a = <B>c;     ');
  assert.equal(comments('const a = <B>c; // d', 'x.ts').length, 1);
});

test('a tsconfig is read as JSONC by TypeScript: a comment opener inside a string survives', () => {
  const text = '{\n  // a line\n  "include": ["src/*.ts"], /* a block */\n  "exclude": ["src/**/*.test.ts"]\n}\n';
  assert.deepEqual(ts.parseConfigFileTextToJson('tsconfig.json', text).config, {
    include: ['src/*.ts'],
    exclude: ['src/**/*.test.ts'],
  });
  // The control: the strippers package-structure used were anchored at a line's start, so a block comment after code
  // stayed in, and JSON.parse refuses it; unanchored, the glob's `/*` opens a comment that runs to the block's close and
  // takes the glob's end with it. (A `/**/` inside a glob opens and closes at once, so it loses four characters.)
  const anchored = text.replace(new RegExp('^\\s*' + SPELLINGS[1], 'gm'), '').replace(new RegExp('^\\s*' + SPELLINGS[0], 'gm'), '');
  assert.throws(() => JSON.parse(anchored), SyntaxError);
  const unanchored = text.replace(new RegExp(SPELLINGS[0], 'g'), '');
  assert.ok(!unanchored.includes('"src/*.ts"') && unanchored.includes('"src*.test.ts"'), unanchored);
  const root = ts.parseConfigFileTextToJson('tsconfig.json', readFileSync('tsconfig.json', 'utf8'));
  assert.equal(root.error, undefined);
  assert.equal(typeof root.config.compilerOptions, 'object');
});
