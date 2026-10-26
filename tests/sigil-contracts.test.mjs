/**
 * **The `_$…$` names are contracts between packages, held by the gate** (2026-10-10). Core keeps its state on an
 * element under sigiled names — never mangled, never an author's — and styles, ui, hooks and directives read them by
 * string, across bundle boundaries; the renderer and its modules carry their own sigiled protocol marks the same way. A
 * rename on one side that forgets the other is no error anywhere: the read is simply `undefined`, in production. So the
 * sources are scanned — as the JavaScript they EMIT (types stripped by esbuild, then comments), so a type literal
 * `{ _$x$: T }` is never read as a write (2026-10-26: one was, and recorded a second writer that did not exist) — and two
 * rules asserted:
 *
 * 1. Every sigiled name READ is WRITTEN somewhere in the sources (`.x =`, `??=`, an object-literal key, `['x'] =`).
 * 2. Every sigiled name has ONE writing package — a second package picking a short sigil (`_$g$`) recreates the
 *    collision inside vera — except the reviewed shared ones below, each with its reason.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { transformSync } from 'esbuild';

const root = new URL('../packages/', import.meta.url).pathname;
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));
const writes = new Map();
const reads = new Map();
/** A source file as the JavaScript it emits: types gone, then comments. */
const emitted = (file) =>
  transformSync(readFileSync(file, 'utf8'), { loader: 'ts' }).code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const add = (map, name, pkg) => (map.get(name) ?? map.set(name, new Set()).get(name)).add(pkg);
const SIGIL = '_\\$[A-Za-z]+\\$';
const WRITE = new RegExp(`\\.(${SIGIL})\\s*(?:=(?!=)|\\?\\?=)|[{,]\\s*(${SIGIL})\\s*:|\\[['"](${SIGIL})['"]\\]\\s*(?:=(?!=)|:)`, 'g');
const READ = new RegExp(`\\.(${SIGIL})|\\[['"](${SIGIL})['"]\\]`, 'g');
for (const pkg of readdirSync(root)) {
  if (!existsSync(join(root, pkg, 'src'))) continue;
  for (const file of walk(join(root, pkg, 'src'))) {
    const code = emitted(file);
    for (const m of code.matchAll(WRITE)) add(writes, m[1] ?? m[2] ?? m[3], pkg);
    for (const m of code.matchAll(READ)) add(reads, m[1] ?? m[2], pkg);
  }
}

/**
 * Core's host fields before they were sigiled (2026-10-10). A read of one is silently `undefined` now — the renderer's
 * slots read `['_root']` and lost closed roots until the full suite caught it — so no source may name one, accessed or
 * quoted.
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

/**
 * RETIRED sigiled names — never written or read again, so one name never carries two meanings across versions (a page
 * mixing an older published core with this one would read the new value as the old field). `_$p$`: the element's
 * priority Sets, since removed; the props store took `_$v$` instead (2026-10-21).
 */
const RETIRED_SIGILS = ['_$p$'];
const reused = RETIRED_SIGILS.filter((name) => writes.has(name) || reads.has(name)).map((name) => `${name} (written by ${[...(writes.get(name) ?? [])].join(', ') || 'none'}, read by ${[...(reads.get(name) ?? [])].join(', ') || 'none'})`);

/**
 * Read and never written in these sources, with the reason. Empty since 2026-10-26: `_$detach$`, the PUBLIC applier
 * teardown opt-in written by author code ("Teardown is opt-in, on the applier", renderer README), is now also written by
 * the renderer's own `until` — so the rule holds without an exception.
 */
const UNWRITTEN = {};
/** Written by more than one package on purpose. */
const SHARED = {
  /**
   * An owner's GENERATION: directives' kill switch bumps it on its own owners (core's stale guard as teardown), and the
   * lists module's `Row` and `List` — hook OWNERS core runs (keyed.ts) — start it and bump it at drop, as every owner does.
   */
  _$g$: ['core', 'directives', 'renderer'],
  /** An owner's hook list (core keeps it on the owner): a `Row` / `List` declares it in its constructor, so its first write is no shape change. */
  _$h$: ['core', 'renderer'],
  /** An owner's teardown flag: a `Row` / `List` starts it `false`, as core does for an element it initializes. */
  _$x$: ['core', 'renderer'],
  /**
   * A component's props record and store, carried across a development-only REDEFINITION by `@verajs/hot` (2026-10-22):
   * the new class's element takes the old one's, so state survives the edit. Development only — `@verajs/hot` never runs
   * in a production page, which is what makes a second writer of these fields acceptable. (Core's own retirement swaps
   * the same two fields; both writers are known.)
   */
  _$raw$: ['core', 'hot'],
  _$v$: ['core', 'hot'],
  /**
   * The release-on-unmount Set for OTHER packages' cleanups — @verajs/hooks' useDismiss, ui's select — created by the
   * first one through `??=`. Core only READS and drains it at removal: its own effects keep their cleanups on their hooks
   * (2026-10-11), so core no longer writes it.
   */
  _$c$: ['hooks', 'ui'],
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

test('no source writes or reads a RETIRED sigil — one name, one meaning, across versions', () => {
  assert.deepEqual(reused, []);
});

test('every sigiled name has one writing package, but the reviewed shared ones', () => {
  const shared = Object.fromEntries([...writes].filter(([, by]) => by.size > 1).map(([name, by]) => [name, [...by].sort()]));
  assert.deepEqual(shared, SHARED);
});
