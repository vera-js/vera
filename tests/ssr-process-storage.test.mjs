/**
 * **`@verajs/ssr` says `ssr-process-storage` exactly when the process has working web storage** (2026-11-21), held to a
 * table of what each Node version does with each flag, measured and written down here, never to the detection's own
 * probe: an oracle computed the way the code computes would share its mistakes. Node 24 makes storage only with
 * `--experimental-webstorage` (`--localstorage-file` alone does nothing, which the flag-text check warned about); Node
 * 26 gives every process a `sessionStorage`. Each row is a fresh process of the Node running this file, so CI's matrix
 * runs each version's rows; a version with no rows fails rather than passing on nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Measured 2026-11-21 (Node 24.18.0, 26.13.1): whether a process started with these flags has working web storage. */
const TABLE = {
  24: [
    [[], false],
    [['--localstorage-file=FILE'], false],
    [['--experimental-webstorage'], true],
    [['--experimental-webstorage', '--localstorage-file=FILE'], true],
    [['--no-experimental-webstorage'], false],
  ],
  26: [
    [[], true],
    [['--localstorage-file=FILE'], true],
    [['--no-experimental-webstorage'], false],
    [['--no-experimental-webstorage', '--localstorage-file=FILE'], false],
  ],
};
const major = Number(process.versions.node.split('.')[0]);
/** The build under test, as the parent runs it: its `--conditions`, and `VERA_DIST` through the environment. */
const conditions = process.execArgv.filter((arg, i, all) => arg.startsWith('--conditions') || all[i - 1] === '--conditions');
const CHILD = `
const said = [];
console.warn = (...a) => said.push(a.join(' '));
await import('@verajs/ssr');
process.stdout.write(JSON.stringify(said.filter((line) => line.includes('ssr-process-storage')).length));
`;

test(`Node ${major}: the storage line is said once exactly where the table says the process has storage`, () => {
  const rows = TABLE[major];
  assert.ok(rows, `no rows for Node ${major}: measure what it does with each flag and add them`);
  const dir = mkdtempSync(join(tmpdir(), 'vera-storage-'));
  try {
    const found = rows.map(([flags]) => {
      const args = flags.map((flag) => flag.replace('FILE', join(dir, 'local.db')));
      const run = spawnSync(process.execPath, [...conditions, ...args, '--input-type=module', '-e', CHILD], { cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 30000 });
      assert.equal(run.status, 0, `${flags.join(' ')}: ${run.stderr}`);
      /** Asking must not make Node print its own warning: on Node 26 a read of `localStorage` without the flag does. */
      assert.doesNotMatch(run.stderr, /localStorage is not available/, `${flags.join(' ')}: the detection touched localStorage`);
      return `${flags.join(' ') || '(none)'}: ${run.stdout}`;
    });
    assert.deepEqual(found, rows.map(([flags, storage]) => `${flags.join(' ') || '(none)'}: ${storage ? 1 : 0}`));
    assert.ok(rows.some(([, storage]) => storage) && rows.some(([, storage]) => !storage), 'CONTROL: the rows hold both answers');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
