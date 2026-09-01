/**
 * **`scripts/gate.mjs` and `.github/workflows/ci.yml` are two hand-maintained copies of one list.**
 *
 * They had already drifted. `scripts/build-kitchen-fixture.mjs --check` was in neither, its fixture
 * went stale, and 35 browser test files spent that time asserting against markup no server emitted.
 * Adding it to the gate would have left CI — the copy that actually blocks a merge — still not
 * running it.
 *
 * The direction that matters is gate → CI: a check somebody added locally and forgot to push into
 * the pipeline is a check that does not gate anything. The reverse is allowed, because CI does
 * things the gate has no business doing (installing browsers, refusing to publish private paths).
 *
 * `npm run x` is resolved through `package.json` before comparing, since the two files spell the
 * same command differently and neither spelling is wrong.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const scripts = JSON.parse(readFileSync(`${root}package.json`, 'utf8')).scripts;
const gateSource = readFileSync(`${root}scripts/gate.mjs`, 'utf8');
const ci = readFileSync(`${root}.github/workflows/ci.yml`, 'utf8');

/** `['name', 'cmd', ['a', 'b']]` -> `cmd a b`, for every entry in the gate's `steps` array. */
const gateSteps = [...gateSource.matchAll(/\[\s*'([^']+)',\s*'([^']+)',\s*\[([^\]]*)\]\s*\]/g)].map(
  ([, name, command, args]) => ({
    name,
    command: [command, ...[...args.matchAll(/'([^']*)'/g)].map(([, a]) => a)].join(' '),
  })
);

/** `npm run check` and `node scripts/sync-packages.mjs` are the same command spelled two ways. */
const resolve = (command) => {
  const run = /^npm run (\S+)$/.exec(command) ?? /^npm (test)$/.exec(command);
  return run && scripts[run[1]] ? scripts[run[1]] : command;
};

test('the gate has steps to compare', () => {
  assert.ok(gateSteps.length >= 8, `parsed ${gateSteps.length} steps from scripts/gate.mjs`);
  assert.ok(gateSteps.some((s) => s.name === 'browser × 3'), 'and parsed them correctly');
});

test('every gate step also runs in CI', () => {
  const missing = gateSteps.filter(({ command }) => {
    const resolved = resolve(command);
    return !ci.includes(command) && !ci.includes(resolved);
  });
  assert.deepEqual(
    missing.map((s) => `${s.name}: ${s.command}`),
    [],
    `these are checked locally and not in the pipeline that blocks a merge:\n  ` +
      `${missing.map((s) => s.command).join('\n  ')}\n` +
      `Add them to .github/workflows/ci.yml.`
  );
});
