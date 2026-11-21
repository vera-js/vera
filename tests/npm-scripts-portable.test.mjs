/**
 * **No npm script sets an environment variable with a shell prefix** (2026-11-20). On Windows npm runs scripts through
 * `cmd`, which reads `NAME=value cmd` as a command named `NAME=value`: `test:browser:all` failed with "'VERA_BROWSERS' is
 * not recognized" before any browser started, so the gate's browser step never ran on Windows. The portable spelling is
 * an argument to `scripts/test-batch.mjs`, which sets each leading `NAME=value` in the command's environment (and starts
 * a project tool's `.cmd` shim, which spawn cannot). Every `package.json` in the repository is read.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Each command of a script that starts with `NAME=value`: commands split on `&&`, `||`, `;` and `|`. */
export const shellPrefixes = (script) =>
  script
    .split(/&&|\|\||;|\|/)
    .map((command) => command.trim())
    .filter((command) => /^[A-Za-z_][A-Za-z0-9_]*=\S*(?:\s|$)/.test(command));

const manifests = execFileSync('git', ['ls-files', '--', ':(glob)**/package.json'], { encoding: 'utf8' }).split('\n').filter(Boolean);

test('no npm script in any package.json sets a variable with a shell prefix', () => {
  assert.ok(manifests.length >= 25 && manifests.includes('package.json'), `CONTROL: ${manifests.length} package.json files read`);
  const found = [];
  let scripts = 0;
  for (const file of manifests) {
    for (const [name, script] of Object.entries(JSON.parse(readFileSync(file, 'utf8')).scripts ?? {})) {
      scripts += 1;
      for (const command of shellPrefixes(script)) found.push(`${file} ${name}: ${command.slice(0, 80)}`);
    }
  }
  assert.ok(scripts >= 45, `CONTROL: ${scripts} scripts read`);
  assert.deepEqual(found, [], 'pass the variable to node scripts/test-batch.mjs instead: node scripts/test-batch.mjs NAME=value <command>');
});

test('the reader finds a prefix at the start of any command, and nowhere else (planted)', () => {
  const old = 'VERA_BROWSERS=chromium web-test-runner --config w.mjs && VERA_BROWSERS=firefox web-test-runner --config w.mjs';
  assert.deepEqual(shellPrefixes(old), ['VERA_BROWSERS=chromium web-test-runner --config w.mjs', 'VERA_BROWSERS=firefox web-test-runner --config w.mjs']);
  assert.equal(shellPrefixes('rollup -c; MODE=prod rollup -c').length, 1, 'after ;');
  assert.equal(shellPrefixes('tsc || CI=1 tsc').length, 1, 'after ||');
  for (const near of [
    'node scripts/test-batch.mjs VERA_DIST=production node --test',
    'node scripts/test-batch.mjs --light VERA_BROWSERS=webkit web-test-runner --config w.mjs',
    'wireit',
    'rollup -c --environment MODE=prod',
    'node -e "a=1"',
  ])
    assert.deepEqual(shellPrefixes(near), [], near);
});
