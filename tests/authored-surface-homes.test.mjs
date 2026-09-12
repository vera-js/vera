/**
 * THE ENFORCEMENT-HOMES SUITE — Phase 1b of the audit plan, the question omni's self-caught
 * inventory hole generalized: every home of the authored surface must have an enforcer, and
 * these are the pins for the homes the enumeration found NAKED. Each spec table here is stated
 * as this suite's OWN expectation, never imported from the implementation it verifies.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('ROUTE_KEYS and RouteOptions agree — the dev warning must never lie about the option set', () => {
  /** The list was hand-extended for `load`; nothing pinned the pair until this. */
  const keys = /const ROUTE_KEYS = \[([^\]]*)\]/.exec(read('packages/router/src/methods.ts'))[1]
    .match(/'([a-z]+)'/gi).map((s) => s.slice(1, -1));
  const optionsBlock = /export interface RouteOptions \{([\s\S]*?)\n\}/.exec(read('packages/router/src/types.ts'))?.[1]
    ?? /export type RouteOptions = \{([\s\S]*?)\n\};/.exec(read('packages/router/src/types.ts'))[1];
  const fields = [...optionsBlock.matchAll(/^  ([a-zA-Z]+)\??:/gm)].map((m) => m[1]);
  assert.deepEqual([...keys].sort(), [...fields].sort(),
    'a route option added to the type must join ROUTE_KEYS in the same edit (and vice versa)');
});

test('the sensor suffix grammar is exactly the documented set, and a typo refuses by name', async () => {
  /** THE SPEC, stated here: these are the only suffixes, per sensor. */
  const SPEC = { 'in-view': ['once', 'down', 'current'], pointer: ['viewport'], size: ['viewport'] };
  const source = read('packages/directives/src/sensors.ts');
  const table = /export const SENSOR_SUFFIXES = \{([\s\S]*?)\} as const;/.exec(source)[1];
  for (const [sensor, flags] of Object.entries(SPEC)) {
    const row = new RegExp(`'?${sensor}'?: \\[([^\\]]*)\\]`).exec(table);
    assert.ok(row, `${sensor} has a row in the one home`);
    assert.deepEqual(row[1].match(/'([a-z]+)'/g).map((s) => s.slice(1, -1)), flags, `${sensor}'s flags`);
  }
  /** And no sensor parses a suffix OUTSIDE the one home any more. */
  assert.doesNotMatch(source, /endsWith\(':viewport'\)/, 'the inline copies died with the consolidation');
});

test('every event the framework dispatches is on the manifest — names are API', () => {
  /** THE SPEC: the complete outbound-event vocabulary. A new dispatch joins this list in the
   *  same edit, or this fails; a listed event nothing dispatches fails the other way. */
  const SPEC = [
    'vera:after-route', 'vera:autoload-error', 'vera:in-view', 'vera:route-error',
    'vd:motion:active', 'vd:motion:idle', 'vd:motion:complete',
  ];
  const found = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist') walk(`${dir}/${entry.name}`);
      else if (/\.(ts|js)$/.test(entry.name)) {
        const text = read(`${dir}/${entry.name}`);
        for (const m of text.matchAll(/['"`](vera:[a-z][a-z-]+|vd:motion:[a-z]+)['"`]/g)) found.add(m[1]);
        /** motion builds names from a NAMESPACE constant — resolve the template form too. */
        for (const m of text.matchAll(/\$\{NAMESPACE\}:([a-z]+)/g)) found.add(`vd:motion:${m[1]}`);
      }
    }
  };
  for (const pkg of readdirSync(new URL('../packages', import.meta.url))) {
    try { walk(`packages/${pkg}/src`); } catch { /* no src */ }
  }
  const spec = new Set(SPEC);
  const undocumented = [...found].filter((e) => !spec.has(e));
  const phantom = SPEC.filter((e) => !found.has(e));
  assert.deepEqual(undocumented, [], `events dispatched but not on the manifest: ${undocumented.join(', ')}`);
  assert.deepEqual(phantom, [], `events on the manifest nothing dispatches: ${phantom.join(', ')}`);
});
