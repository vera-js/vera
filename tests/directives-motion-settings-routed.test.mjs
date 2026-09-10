/**
 * THE ACCEPTED-AND-INERT TRIPWIRE — every settings key the vocabulary accepts must go somewhere.
 *
 * `will-change` proved the class: a key can parse clean, validate, vendor across engines,
 * corpus-pin — and route to NOTHING, silently, for months (it reached emission only when the
 * size audit tripped over it). A grammar key that dies in transit is half a refusal story: the
 * author was told yes and nothing happened. This suite walks the CORE settings table out of the
 * built bundle and asserts every key is CONSUMED by name somewhere past its own definition —
 * generation, runtime, or the pack's wiring — or sits on the documented inert list with a
 * reason. Adding a key without a consumer fails here on the day it is added. (Joint tripwire —
 * omni runs the mirror over its vendored vocabulary.)
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * Keys legitimately consumed nowhere in this pack's source, each with the reason. Empty today —
 * which is the point: an entry here is a DELIBERATE record, not an escape hatch.
 */
const INERT = new Map([]);

/** Both homes since the package cut: the motion engine and the directives pack that wires it. */
const dir = new URL('../packages/motion/src/', import.meta.url);
const packDir = new URL('../packages/directives/src/motion/', import.meta.url);
const sources = [
  ...readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'schema.ts').map((f) => readFileSync(new URL(f, dir), 'utf8')),
  ...readdirSync(packDir).filter((f) => f.endsWith('.ts')).map((f) => readFileSync(new URL(f, packDir), 'utf8')),
].join('\n');

test('every core settings key is routed past its definition, or documented inert', async () => {
  const { load } = await import('./dist.mjs');
  const { writePath } = await load('directives/motion');
  void writePath; // ensures the bundle under test is the resolvable one

  /** The table itself comes from source (the built bundle mangles nothing here, but source is
   *  the durable address for a structural test). */
  const schema = readFileSync(new URL('schema.ts', dir), 'utf8');
  const keys = [...schema.matchAll(/\{ key: '([a-z-]+)', type:/g)].map((m) => m[1]);
  assert.ok(keys.length >= 10, `the CONTROL: the table was actually read (${keys.length} keys)`);

  const unrouted = keys.filter((key) =>
    !INERT.has(key) && !new RegExp(`['\`]${key}['\`\\]]`).test(sources));
  assert.deepEqual(unrouted, [],
    `accepted-and-inert settings (route them or add them to INERT with a reason): ${unrouted.join(', ')}`);
});
