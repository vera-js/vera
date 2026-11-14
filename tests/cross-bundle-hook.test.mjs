/**
 * **The hook fields another bundle reads stay one name on both sides** (Brian's ruling, 2026-11-13). Core's hook record
 * is read directly by the renderer's keyed module (a list's parent hook), not only through the seams, and each
 * production bundle mangles on its own. A field renamed in core alone builds, type-checks in each package and passes
 * every development test, and production then reads `undefined` across the boundary. `CrossBundleHook` in core's
 * types.ts declares the fields; this holds both production bundles to that declaration: every declared field is a
 * property in core's min (the writer) and in the keyed module's min (the reader). The fields come from a PARSE of
 * types.ts, so a field added to the type is checked without editing this file.
 *
 * Its control renames one field on one side, in memory, and the check must name it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const root = new URL('..', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const CORE = 'packages/core/dist/vera.min.js';
const KEYED = 'packages/renderer/dist/vera-renderer-keyed.min.js';

/** The member names of `CrossBundleHook`, read from core's types.ts by the TypeScript parser. */
const declared = () => {
  const file = ts.createSourceFile('types.ts', read('packages/core/src/types.ts'), ts.ScriptTarget.Latest, true);
  let names;
  const visit = (node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === 'CrossBundleHook' && ts.isTypeLiteralNode(node.type))
      names = node.type.members.map((m) => m.name.getText(file));
    ts.forEachChild(node, visit);
  };
  visit(file);
  return names;
};

/** Whether `name` is accessed or defined as a property in `code` (`.name` or a method/key `name(` / `name:`). */
const hasProperty = (code, name) => {
  const id = name.replace(/\$/g, '\\$');
  return new RegExp(`\\.${id}(?![\\w$])|[{,;]\\s*${id}\\s*[(:=]`).test(code);
};

/** The declared fields one side lacks: `[side, field]` pairs. */
const missing = (fields, core, keyed) => [
  ...fields.filter((f) => !hasProperty(core, f)).map((f) => ['core', f]),
  ...fields.filter((f) => !hasProperty(keyed, f)).map((f) => ['keyed', f]),
];

test('CrossBundleHook declares its fields (the parse found them)', () => {
  const fields = declared();
  assert.ok(Array.isArray(fields) && fields.length >= 2, `CrossBundleHook's members: ${fields}`);
  assert.ok(fields.includes('$runs') && fields.includes('$n'), `expected $runs and $n among ${fields}`);
});

test('CONTROL: a field renamed on one side only is named by the check', () => {
  const fields = declared();
  const core = read(CORE);
  const keyed = read(KEYED);
  assert.deepEqual(missing(fields, core.replaceAll('$runs', '$runz'), keyed), [['core', '$runs']]);
  assert.deepEqual(missing(fields, core, keyed.replaceAll('$runs', '$runz')), [['keyed', '$runs']]);
});

test("every CrossBundleHook field is a property in core's production bundle and in the keyed module's", () => {
  assert.deepEqual(missing(declared(), read(CORE), read(KEYED)), []);
});
