/**
 * `@verajs/eslint-config` and `@verajs/tsconfig` — the two packages that ship configuration rather
 * than code.
 *
 * They need a suite for the same reason everything else here does: nothing else executes them. The
 * repo consumes the eslint config in its own `eslint.config.js`, so a broken rule would surface —
 * but only for rules the repo happens to violate, which is none of them. And nothing at all
 * consumes the tsconfig, because this repo deliberately keeps standard class-field semantics.
 *
 * So each rule is run against source written to violate it, and the tsconfig is resolved and
 * compiled the way a consumer would. Asserting a rule *fires* matters more than asserting the tree
 * is clean: a selector with a typo silently matches nothing and passes every clean-tree check.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

/** A throwaway project that can resolve this repo's node_modules, so the workspace links apply. */
const project = (files) => {
  const dir = mkdtempSync(join(tmpdir(), 'vera-config-'));
  symlinkSync(join(repo, 'node_modules'), join(dir, 'node_modules'), 'dir');
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
};

const run = (cmd, args, cwd) => {
  try {
    return { code: 0, out: execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe' }) };
  } catch (error) {
    return { code: error.status ?? 1, out: (error.stdout ?? '') + (error.stderr ?? '') };
  }
};

const ESLINT_CONFIG = `
import tsParser from '${repo}/node_modules/@typescript-eslint/parser/dist/index.js';
import vera from '@verajs/eslint-config';
export default [
  { files: ['**/*.ts'], languageOptions: { parser: tsParser } },
  ...vera,
];
`;

const lint = (source) => {
  const dir = project({ 'eslint.config.mjs': ESLINT_CONFIG, 'subject.ts': source });
  const { out } = run(join(repo, 'node_modules/.bin/eslint'),
    ['--no-config-lookup', '-c', 'eslint.config.mjs', 'subject.ts'], dir);
  rmSync(dir, { recursive: true, force: true });
  return out;
};

test('eslint-config: flags a plain class field on a custom element', () => {
  const out = lint('class Card extends HTMLElement { user?: string; }');
  assert.match(out, /no-restricted-syntax/);
  assert.match(out, /declare item\?: Thing/, 'the message must say what to write instead');
});

test('eslint-config: a field with no initializer is still flagged', () => {
  // The trap within the trap — `user?: T` emits `user;` just as `user = undefined` does.
  assert.match(lint('class Card extends HTMLElement { user; }'), /no-restricted-syntax/);
});

test('eslint-config: `declare` is accepted', () => {
  const out = lint('class Card extends HTMLElement { declare user?: string; }');
  assert.doesNotMatch(out, /no-restricted-syntax/);
});

test('eslint-config: `static styles` is accepted', () => {
  // The @verajs/styles pattern. A static member is never an instance field and never clobbers.
  const out = lint("class Card extends HTMLElement { static styles = 'a{}'; }");
  assert.doesNotMatch(out, /no-restricted-syntax/);
});

test('eslint-config: customized built-ins are covered too', () => {
  assert.match(lint('class Cell extends HTMLDivElement { value = 0; }'), /no-restricted-syntax/);
});

test('eslint-config: an anonymous class in customElements.define is covered', () => {
  const out = lint("customElements.define('x-a', class extends HTMLElement { value = 0; });");
  assert.match(out, /no-restricted-syntax/);
});

test('eslint-config: a plain class is left alone', () => {
  assert.doesNotMatch(lint('class Plain { value = 0; }'), /no-restricted-syntax/);
});

test('eslint-config: flags `insert` taken from @verajs/inserts', () => {
  const out = lint("import { insert } from '@verajs/inserts';\ninsert('render', () => {}, 1);");
  assert.match(out, /no-restricted-imports/);
  assert.match(out, /silently does nothing/, 'the message must name the production failure');
});

test('eslint-config: importing the registry itself is allowed', () => {
  // `connectInserts(inserts)` is the documented CDN wiring and must not be caught.
  const out = lint("import { inserts } from '@verajs/inserts';\nconsole.log(inserts);");
  assert.doesNotMatch(out, /no-restricted-imports/);
});

test('eslint-config: `insert` from core is allowed', () => {
  const out = lint("import { insert } from '@verajs/core';\ninsert('init', () => {}, 50);");
  assert.doesNotMatch(out, /no-restricted-imports/);
});

test('tsconfig: `extends` resolves by bare specifier', () => {
  const dir = project({
    'tsconfig.json': JSON.stringify({ extends: '@verajs/tsconfig', include: ['subject.ts'] }),
    'subject.ts': 'export const a = 1;',
  });
  const { code, out } = run(join(repo, 'node_modules/.bin/tsc'), ['--showConfig', '-p', 'tsconfig.json'], dir);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(code, 0, out);
  const resolved = JSON.parse(out).compilerOptions;
  assert.equal(resolved.useDefineForClassFields, false, 'the setting this package exists for');
  assert.equal(resolved.target?.toLowerCase(), 'es2022');
});

test('tsconfig: a field declaration emits nothing under it', () => {
  const dir = project({
    'tsconfig.json': JSON.stringify({
      extends: '@verajs/tsconfig',
      compilerOptions: { outDir: 'out', noEmit: false },
      include: ['subject.ts'],
    }),
    'subject.ts': 'export class Card extends HTMLElement { user?: string; }',
  });
  const { code, out } = run(join(repo, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json'], dir);
  assert.equal(code, 0, out);
  const emitted = execFileSync('cat', [join(dir, 'out/subject.js')], { encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  assert.doesNotMatch(emitted, /\buser\b/,
    'a bare declaration must emit no field — that is the whole point of the package');
});
