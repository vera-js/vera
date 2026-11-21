/**
 * **Every workspace package a package's source imports resolves to SOURCE through the root tsconfig's `paths`**
 * (2026-11-20). A specifier with no entry falls through to `node_modules`, where it resolves to the package's built
 * `.d.ts`: the type check then needs a build that nothing orders, and in a parallel clean build it can run first. select
 * imported `@verajs/renderer/keyed` and `/slots`, which had no entry, and its build reported 24 type errors (TS2307 on
 * both, and 15 implicit-any parameters that followed) whenever renderer's types were not yet written. Every package
 * tsconfig extends the root and none sets `paths`, so this one list serves every package.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import ts from 'typescript';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean);
const paths = ts.parseConfigFileTextToJson('tsconfig.json', readFileSync('tsconfig.json', 'utf8')).config.compilerOptions.paths;

/** Each workspace package's name and its directory. */
const packages = new Map(
  git('ls-files', '--', 'packages').filter((f) => f.endsWith('/package.json')).map((f) => [JSON.parse(readFileSync(f, 'utf8')).name, f.slice(0, -'/package.json'.length)]),
);
const packageOf = (specifier) => (specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]);

/** Every module specifier `text` names, from a parse: imports, re-exports, `import()` and `import('…')` types. */
export const specifiers = (text, name = 'x.ts') => {
  const found = [];
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) found.push(node.moduleSpecifier.text);
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) found.push(node.arguments[0].text);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) found.push(node.argument.literal.text);
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true));
  return found;
};

/** `file: specifier` for each workspace specifier in `sources` that `map` does not name. */
export const unmapped = (sources, map) =>
  sources.flatMap(([file, text]) => specifiers(text, file).filter((s) => packages.has(packageOf(s)) && !map[s]).map((s) => `${file}: ${s}`));

const sources = git('ls-files', '--', 'packages')
  .filter((f) => f.includes('/src/') && f.endsWith('.ts') && !f.endsWith('.d.ts'))
  .map((f) => [f, readFileSync(f, 'utf8')]);

test('every workspace package a package source imports has a root tsconfig paths entry', () => {
  assert.ok(packages.size >= 20 && sources.length >= 200, `CONTROL: ${packages.size} packages, ${sources.length} sources`);
  const used = new Set(sources.flatMap(([file, text]) => specifiers(text, file)).filter((s) => packages.has(packageOf(s))));
  assert.ok(used.size >= 10, `CONTROL: ${used.size} workspace specifiers imported`);
  assert.deepEqual(unmapped(sources, paths), [], 'add a paths entry pointing at the source file the package builds that entry from');
});

test('every paths entry points at a source file inside the package it names', () => {
  const wrong = [];
  for (const [specifier, targets] of Object.entries(paths)) {
    const dir = packages.get(packageOf(specifier));
    for (const target of targets) {
      const file = target.replace(/^\.\//, '');
      if (!dir || !file.startsWith(`${dir}/src/`) || !existsSync(file)) wrong.push(`${specifier} → ${target}`);
    }
  }
  assert.deepEqual(wrong, []);
});

test('the guard names a dropped entry, and passes a relative or foreign import (planted)', () => {
  const { ['@verajs/renderer/keyed']: dropped, ...rest } = paths;
  assert.ok(dropped, 'CONTROL: the entry exists to drop');
  const select = sources.filter(([file]) => file.endsWith('select/src/select/element.ts'));
  assert.equal(select.length, 1);
  assert.deepEqual(unmapped(select, rest), ['packages/components/select/src/select/element.ts: @verajs/renderer/keyed']);
  assert.deepEqual(unmapped([['x.ts', "import a from './a.js';\nimport b from 'typescript';\nconst c = () => import('node:fs');"]], {}), []);
  assert.deepEqual(unmapped([['x.ts', "export * from '@verajs/core';\ntype T = import('@verajs/renderer/tag').X;"]], {}), ['x.ts: @verajs/core', 'x.ts: @verajs/renderer/tag']);
});
