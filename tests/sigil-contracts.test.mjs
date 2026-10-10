/**
 * **The `_$…$` names are contracts between packages, held by the gate** (O4, 2026-10-10). Core keeps its state on an
 * element under sigiled names — never mangled, never an author's — and styles, ui, hooks and directives read them by
 * string, across bundle boundaries; the renderer and its modules carry their own sigiled protocol marks the same way. A
 * rename on one side that forgets the other is no error anywhere: the read is simply `undefined`, in production. So the
 * sources are scanned (comments stripped) and two rules asserted:
 *
 * 1. Every sigiled name READ is WRITTEN somewhere in the sources (`.x =`, `??=`, an object-literal key, `['x'] =`).
 * 2. Every sigiled name has ONE writing package — a second package picking a short sigil (`_$g$`) recreates the
 *    collision inside vera — except the reviewed shared ones below, each with its reason.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../packages/', import.meta.url).pathname;
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));
const writes = new Map();
const reads = new Map();
const add = (map, name, pkg) => (map.get(name) ?? map.set(name, new Set()).get(name)).add(pkg);
const SIGIL = '_\\$[A-Za-z]+\\$';
const WRITE = new RegExp(`\\.(${SIGIL})\\s*(?:=(?!=)|\\?\\?=)|[{,]\\s*(${SIGIL})\\s*:|\\[['"](${SIGIL})['"]\\]\\s*(?:=(?!=)|:)`, 'g');
const READ = new RegExp(`\\.(${SIGIL})|\\[['"](${SIGIL})['"]\\]`, 'g');
for (const pkg of readdirSync(root)) {
  if (!existsSync(join(root, pkg, 'src'))) continue;
  for (const file of walk(join(root, pkg, 'src'))) {
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const m of code.matchAll(WRITE)) add(writes, m[1] ?? m[2] ?? m[3], pkg);
    for (const m of code.matchAll(READ)) add(reads, m[1] ?? m[2], pkg);
  }
}

/**
 * Core's host fields before O4 (2026-10-10). A read of one is silently `undefined` now — the renderer's slots read
 * `['_root']` and lost closed roots until the full suite caught it — so no source may name one, accessed or quoted.
 */
const RETIRED = ['_gen', '_hooks', '_hookPriorities', '_root', '_cleanups', '_removed', '_doc', '_moved', '_setup'];
const retired = [];
for (const pkg of readdirSync(root)) {
  if (!existsSync(join(root, pkg, 'src'))) continue;
  for (const file of walk(join(root, pkg, 'src'))) {
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const m of code.matchAll(new RegExp(`\\.(${RETIRED.join('|')})\\b|['"](${RETIRED.join('|')})['"]`, 'g')))
      retired.push(`${file.slice(root.length)}: ${m[1] ?? m[2]}`);
  }
}

/** Read and never written in these sources, with the reason. */
const UNWRITTEN = {
  /**
   * A PUBLIC opt-in written by AUTHOR code, never by ours: "Teardown is opt-in, on the applier" — `applyThing._$detach$ =
   * (previous) => …` (renderer README, the applier teardown section); declaring it arms the renderer's teardown walk.
   * Read by renderer.ts and hydration.ts, covered by tests/renderer-teardown. Not dead code.
   */
  _$detach$: ['renderer'],
};
/** Written by more than one package on purpose. */
const SHARED = {
  /** Directives' kill switch BUMPS core's generation on its own owners — core's stale guard as teardown. */
  _$g$: ['core', 'directives'],
  /** The template-result protocol (lit's interop name): core's `html` and the renderer's `tag()` build the same shape. */
  _$litType$: ['core', 'renderer'],
  /** The seams mark a pack's wire function tests for: directives' seams and motion's SSR seams carry it. */
  _$seams$: ['directives', 'motion'],
};

test('CONTROL: the scan found the contracts (core host state and its readers)', () => {
  assert.ok(writes.get('_$r$')?.has('core') && reads.get('_$r$')?.has('styles'), 'core writes _$r$ and styles reads it');
  assert.ok(writes.size >= 20, `${writes.size} sigiled names written`);
});

test('every sigiled name a package reads is written somewhere — a one-sided rename goes red here, not in production', () => {
  const unwritten = [...reads].filter(([name]) => !writes.has(name)).map(([name, by]) => `${name} (read by ${[...by].join(', ')})`);
  assert.deepEqual(unwritten, Object.entries(UNWRITTEN).map(([name, by]) => `${name} (read by ${by.join(', ')})`));
});

test("no source reads core's retired host names — a stale read is silently undefined", () => {
  assert.deepEqual(retired, []);
});

test('every sigiled name has one writing package, but the reviewed shared ones', () => {
  const shared = Object.fromEntries([...writes].filter(([, by]) => by.size > 1).map(([name, by]) => [name, [...by].sort()]));
  assert.deepEqual(shared, SHARED);
});
