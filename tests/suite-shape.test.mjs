/**
 * Suites that cannot silently stop running.
 *
 * Nineteen suites here are **flat scripts** rather than `node:test` files: they accumulate into
 * `pass`/`fail`, print a summary, and end with a top-level `process.exit(fail ? 1 : 0)`. That shape is
 * deliberate and works well — but it has one trap, and appending to such a file is the most natural
 * thing to do.
 *
 * **Anything added after that line never runs, and the suite still reports success.** It was caught
 * here by writing six checks into `router-guards`, watching the count stay at 17, and only then
 * looking at where the block had landed. A `console.log` inserted to debug it never printed, which is
 * what finally gave it away — the assertions had not failed, they had not executed.
 *
 * That is the same failure as a test that asserts nothing, and it is worse than a red suite: a green
 * one is evidence, and this makes it evidence of nothing.
 *
 * **Only column-zero exits count.** An indented `process.exit(1)` inside `if (failures.length) { … }`
 * is the normal shape of these files, and the code after it is the success path. A first version of
 * this check stripped indentation, flagged five suites, and every one was correct.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const suites = globSync('tests/**/*.test.{mjs,js}', { cwd: root });

test('no suite has code after an unconditional top-level process.exit', () => {
  assert.ok(suites.length > 100, `only ${suites.length} suites found — the glob has stopped matching`);

  const unreachable = [];
  for (const suite of suites) {
    const lines = readFileSync(join(root, suite), 'utf8').split('\n');
    lines.forEach((line, index) => {
      /** Column zero: not inside an `if`, so it always runs and always ends the process. */
      if (!/^process\.exit\(/.test(line)) return;
      const after = lines
        .slice(index + 1)
        .filter((rest) => rest.trim() && !/^(\/\/|\*|\/\*)/.test(rest.trim()));
      if (after.length)
        unreachable.push(
          `${suite}:${index + 1} — ${after.length} line(s) after it never run, starting: ${after[0].trim().slice(0, 70)}`
        );
    });
  }

  assert.deepEqual(
    unreachable,
    [],
    `these suites report success while part of them never executes:\n  ${unreachable.join('\n  ')}`
  );
});
