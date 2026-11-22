/**
 * **No statement in shipped source is a bare property read.** The production build runs terser with `pure_getters`
 * (defaultRollupConfig.js), which assumes reading a property has no effect, so a statement that only reads one is
 * removed from the min. A read written to subscribe an effect (`effect(() => { void host.off; sync(); })`) or to force
 * layout (`void el.offsetHeight`) works in development and silently does nothing in production: select's author
 * trigger stopped following a `<fieldset disabled>` in the min that way, while every development row stayed green.
 * Pass the value instead (`sync(host.off)`), or read it into something used.
 *
 * Read from TypeScript's parse of every `src` file of every package: an expression statement whose expression, after
 * `void` and parentheses, is a property or element access (a bare identifier reads nothing, so it is allowed: it is the
 * lint idiom for a value kept on purpose). A multi-line expression whose last
 * line happens to look like one is not, which is why this parses rather than greps.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

/** The statements a min drops: `void a.b;`, `a.b;`, `(a.b);`, `void a[b];`. */
export const droppedReads = (source, fileName = 'x.ts') => {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found = [];
  const visit = (node) => {
    if (ts.isExpressionStatement(node)) {
      let expression = node.expression;
      for (;;) {
        if (ts.isVoidExpression(expression) || ts.isParenthesizedExpression(expression)) expression = expression.expression;
        else break;
      }
      /** A bare identifier (`void unused;`, the lint idiom for a value kept on purpose) reads nothing, dropped or not. */
      if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression))
        found.push(`${fileName}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${node.getText()}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
};

const sources = execFileSync('git', ['ls-files', '--', 'packages/**/src/**/*.ts', 'packages/**/src/*.ts'], { encoding: 'utf8' })
  .split('\n')
  .filter((path) => path !== '' && !path.endsWith('.d.ts'));

test('CONTROL: the reader finds each shape a min drops, and passes reads that are used', () => {
  const planted = [
    'effect(() => { void entry.host.off; trigger.sync(); });',
    'el.offsetHeight;',
    '(host.pending);',
    'void list[0];',
    'void getComputedStyle(node).transitionProperty;',
  ].join('\n');
  assert.equal(droppedReads(planted).length, 5, droppedReads(planted).join('\n'));
  const used = [
    'effect(() => trigger.sync(entry.host.off));',
    'const unit = a.b ??\n  c.d;',
    'void sideEffect();',
    'x.y = 1;',
    'a.b();',
    'void unused;',
    "if (getComputedStyle(node).transitionProperty !== '\\0') arm();",
  ].join('\n');
  assert.deepEqual(droppedReads(used), []);
});

test('no shipped source file has a statement that is only a property read', () => {
  assert.ok(sources.length > 100, `CONTROL: the corpus is the packages' source (${sources.length} files)`);
  const found = sources.flatMap((path) => droppedReads(readFileSync(path, 'utf8'), path));
  assert.deepEqual(found, [], `pure_getters drops these from the production build; pass the value instead:\n${found.join('\n')}`);
});
