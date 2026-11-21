/**
 * **`isServer` answers where the code runs** (2026-11-20): `true` once `@verajs/ssr` is imported (it sets `_$ssr$` on the
 * global before anything imports core), `false` in a page or a plain Node process. Each in its own fresh process,
 * against the build under test, so the answer is the one core computed at load: one process with ssr imported first,
 * one with core alone. Either flipping red is the check working: drop the flag in ssr's shim and the first fails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { isProduction } from './dist.mjs';

const ask = (imports) =>
  execFileSync(
    process.execPath,
    [...(isProduction ? [] : ['--conditions', 'development']), '--input-type=module', '-e',
      `${imports}\nconst { isServer } = await import('@verajs/core');\nconsole.log(JSON.stringify(isServer));`],
    { encoding: 'utf8', env: { ...process.env } }
  ).trim().split('\n').at(-1);

test('isServer is true where @verajs/ssr renders', () => {
  assert.equal(ask("await import('@verajs/ssr');"), 'true');
});

test('isServer is false without it (CONTROL: the same question, the same build)', () => {
  assert.equal(ask(''), 'false');
});
