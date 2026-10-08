/**
 * **A test wires through core's registry, never a standalone `@verajs/inserts`.**
 *
 * CLAUDE.md's rule for modules — take `wire` from core — holds for test code too, and for the same reason: a
 * production `@verajs/inserts` bundle is a SECOND map beside the one core inlines, so a suite that wires through it
 * tests a two-registry page in production while development, where both resolve to one copy, looks right. It lived in
 * the shared harness (`tests/hydration.mjs`, until 2026-10-08): the renderer was connected to both registries, slots
 * wired through core was never asked, and production rows passed or failed for the wrong reason — found by luck,
 * checking a migration in production. A rule in prose did not keep it out of a helper; this file does.
 *
 * A file that genuinely tests the inserts module ITSELF goes on the list below, with its reason.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const ALLOWED = {
  'module-api.test.mjs': "the inserts module's own `wire` — descriptors, nested arrays, priority order",
  'setter-arguments.test.mjs': "`wire`'s argument validation; nothing renders through it",
};

const dir = new URL('./', import.meta.url);
/** The API, not the word: a `load('inserts')` call, or a value import of the package at the start of a line. */
const USES = /\bload\(\s*['"]inserts['"]\s*\)|^\s*import\s+(?!type\b)[^;]*?from\s+['"]@verajs\/inserts['"]/m;
const users = readdirSync(dir)
  .filter((name) => name.endsWith('.mjs') && name !== 'one-registry.test.mjs')
  .filter((name) => USES.test(readFileSync(new URL(name, dir), 'utf8')));

test('only a suite testing the inserts module itself takes the standalone registry', () => {
  /** CONTROL: the scan finds what it must — a scan that matches nothing reports a clean tree. */
  assert.ok(users.includes('module-api.test.mjs'), 'the scan reaches a file known to use it');
  assert.deepEqual(users.filter((name) => !(name in ALLOWED)), [],
    "wire through core: `const { wire, inserts } = await load('core')` — or add the file to ALLOWED with its reason");
});

test('every allowed file still uses it, so the list cannot outlive its reasons', () => {
  assert.deepEqual(Object.keys(ALLOWED).filter((name) => !users.includes(name)), []);
});
