/**
 * **One core, whatever drive-letter case the process started with** (Windows; `tests/dist.mjs`).
 *
 * Windows paths are case-insensitive, but Node keys a module by its exact URL. VS Code and Git Bash start processes in
 * `c:\…`, so a suite's `import.meta.url` is `file:///c:/…`, while a bundle's bare `@verajs/core` resolves through
 * `node_modules` to `file:///C:/…`: two instances of core, and in production (inserts inlined) two registries, so a
 * component renders nothing (`no-renderer`). Found 2026-11-21 on the Windows machine; until 2026-11-20 it was run around
 * with upper-case paths instead of fixed. The fix: `dist.mjs` builds every URL from its own CANONICAL path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const flip = (path) => path.replace(/^[A-Za-z]:/, (drive) => (drive === drive.toUpperCase() ? drive.toLowerCase() : drive.toUpperCase()));

test('core loaded through dist.mjs from a lower-case drive is the core a bare import resolves', { skip: process.platform !== 'win32' && 'drive letters are Windows only' }, () => {
  /** Start the child in the OTHER casing from this one, and load dist.mjs through that casing too. */
  for (const root of [flip(ROOT), ROOT]) {
    const dist = pathToFileURL(root + 'tests/dist.mjs').href;
    const script = `const { distUrl } = await import(${JSON.stringify(dist)});
const viaDist = await import(distUrl('core'));
const bare = await import('@verajs/core');
console.log(JSON.stringify({ same: viaDist === bare, url: distUrl('core') }));`;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, env: { ...process.env, VERA_DIST: 'production' }, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const { same, url } = JSON.parse(run.stdout.trim());
    assert.ok(same, `two cores from a ${root.slice(0, 2)} start: dist.mjs gave ${url}`);
  }
});
