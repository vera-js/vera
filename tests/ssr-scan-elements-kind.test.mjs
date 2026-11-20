/**
 * **Every fresh scan's `opens` is born an array of objects** (2026-11-20). `scanTag` pushes `{ name, foreign, inert,
 * space }` entries onto the `opens` its state carries, and V8's optimized scan learns the array's elements kind. A
 * fresh `[]` is born an array of small integers and changes kind at its first push, so each render's fresh `opens`
 * arrived in a kind the optimized scan had not seen: "wrong map" deopts on the second and seventh renders and a
 * "not a Smi" one on the third, of a 50 KB `.innerHTML` value, each throwing the optimized scan away. Its first 100
 * renders took 82.3 ms; with `freshScan` copying an empty array that already holds objects, 64.7 ms (0.3.0: 78.8), the
 * renders after them unchanged.
 *
 * No code read shows this, and no correctness test can: `opens: []` and the copy are the same empty array to every
 * program. So the elements kind is asserted here, in a child process that can ask V8 (`--allow-natives-syntax`), with
 * a control that the question tells the two kinds apart. Planted red by writing `opens: []` back.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const tokenizer = new URL('../packages/ssr/dist/vera/tokenizer.js', import.meta.url).href;

test("a fresh scan's opens is an array of objects from birth", () => {
  const out = execFileSync(process.execPath, [
    '--allow-natives-syntax', '--input-type=module', '-e',
    `const { freshScan } = await import(${JSON.stringify(tokenizer)});
     const kinds = (a) => [%HasSmiElements(a), %HasObjectElements(a)];
     console.log(JSON.stringify({ literal: kinds([]), held: kinds([{}]), depth0: kinds(freshScan(0).opens), depth2: kinds(freshScan(2).opens), empty: freshScan(0).opens.length }));`,
  ], { encoding: 'utf8' });
  const r = JSON.parse(out.trim().split('\n').pop());
  /** The control: the question must tell an `[]` literal (small integers) from an array holding an object, or every
   *  answer below would mean nothing. */
  assert.deepEqual(r.literal, [true, false], `CONTROL: V8 reads an [] literal as small-integer elements (${r.literal})`);
  assert.deepEqual(r.held, [false, true], `CONTROL: V8 reads [{}] as object elements (${r.held})`);
  assert.equal(r.empty, 0, 'a fresh scan opens nothing');
  for (const k of ['depth0', 'depth2'])
    assert.deepEqual(r[k], [false, true], `freshScan's opens (${k}) is not born an array of objects: an \`opens: []\` there brings back the optimized scan's deopts on a long value's first renders — see this file`);
});
