/**
 * **`trigger` and `triggerAt` stay textually identical where they are meant to be.** `triggerAt` is `trigger` with the
 * wake number given, kept as a second address on purpose (an optional parameter on `trigger` cost every plain write
 * 0.4–0.6%). A fix to one is a fix to both, so the statements after `trigger`'s own `const epoch = ++wakes` must be
 * `triggerAt`'s statements, character for character. CONTROL: the check finds both functions and compares something.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const file = 'packages/core/src/services/track.ts';
const source = ts.createSourceFile(file, readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
/** The body statements of the arrow function bound to `name` at module level, as text. */
const bodyOf = (name) => {
  for (const statement of source.statements)
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations)
        if (declaration.name.getText(source) === name && declaration.initializer && ts.isArrowFunction(declaration.initializer) && ts.isBlock(declaration.initializer.body))
          return declaration.initializer.body.statements.map((s) => s.getText(source));
  return undefined;
};

test('the statements after trigger\'s own wake number are triggerAt\'s, character for character', () => {
  const trigger = bodyOf('trigger');
  const triggerAt = bodyOf('triggerAt');
  assert.ok(trigger && triggerAt, 'CONTROL: both functions found');
  assert.equal(trigger[0], 'const epoch = ++wakes;', "trigger's first statement takes the wake number");
  assert.ok(triggerAt.length >= 2, 'CONTROL: there is something to compare');
  assert.deepEqual(trigger.slice(1), triggerAt);
});
