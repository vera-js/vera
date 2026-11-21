/**
 * **`isServer()` answers where the code runs** (2026-11-20): `true` once `@verajs/ssr` is imported (it sets `_$ssr$` on
 * the global), `false` in a page or a plain Node process — and, read when called, the same answer whichever module was
 * imported FIRST: as a constant computed at load it answered `false` for a process that imported core before ssr,
 * failing open. Each in its own fresh process, against the build under test. Either flipping red is the check working:
 * drop the flag in ssr's shim and the first fails; make it a load-time constant again and the import-order row fails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { isProduction } from './dist.mjs';

const ask = (imports, after = '') =>
  execFileSync(
    process.execPath,
    [...(isProduction ? [] : ['--conditions', 'development']), '--input-type=module', '-e',
      `${imports}\nconst { isServer } = await import('@verajs/core');\n${after}\nconsole.log(JSON.stringify(isServer()));`],
    { encoding: 'utf8', env: { ...process.env } }
  ).trim().split('\n').at(-1);

test('isServer is true where @verajs/ssr renders', () => {
  assert.equal(ask("await import('@verajs/ssr');"), 'true');
});

test('isServer is false without it (CONTROL: the same question, the same build)', () => {
  assert.equal(ask(''), 'false');
});

test('isServer() is true when core was imported BEFORE @verajs/ssr (the import order a server can have)', () => {
  assert.equal(ask('', "await import('@verajs/ssr');"), 'true');
});
