/**
 * **The store baseline's comparison** (step (b), 2026-10-26): S against the frozen reference, with a BYTE-IDENTICAL A/A of
 * the reference and a PLANTED reference (counted work spliced into both of its `get` traps: K iterations into a global
 * sink, K calibrated once, the same everywhere — never a timed wait). Every arm a PRODUCTION min bundle; three fresh
 * processes per arm, the arm order rotated each round. A BASELINE: a row where S is slower in every process beyond the
 * A/A spread is a GAP, labeled with the speed brick that sizes it — never a verdict. The plant must read as a loss on
 * rows 1–5, or the run is VOID (it is a sensitivity check: spliced into the trap it may de-inline it, so it over-reads).
 * Usage: node bench/store-baseline/compare.mjs [rounds=3] [K=4]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const [rounds = 3, K = 4] = process.argv.slice(2).map(Number);
const ref = join(root, '.probe/additive/ref/core/vera.min.js');
const work = join(root, '.probe/baseline');
mkdirSync(work, { recursive: true });
const aa = join(work, 'ref-aa.min.js');
/** The bytes, never the file's mode: the frozen reference is read-only on disk, and a mode-preserving copy stays so. */
rmSync(aa, { force: true });
writeFileSync(aa, readFileSync(ref));
const plantSrc = readFileSync(ref, 'utf8');
const TRAP = /get\(t,o,e\)\{/g;
const traps = plantSrc.match(TRAP)?.length ?? 0;
if (traps !== 2) throw new Error(`the reference must have exactly its 2 get traps to plant into, found ${traps}`);
const plant = join(work, 'ref-plant.min.js');
rmSync(plant, { force: true });
writeFileSync(plant, `globalThis.__PS__=0;` + plantSrc.replace(TRAP, `get(t,o,e){for(let i=0;i<${K};i++)globalThis.__PS__+=i;`));
const ARMS = { S: join(root, 'packages/core/dist/vera.min.js'), ref, 'ref A/A': aa, plant };
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 12);
if (sha(aa) !== sha(ref)) throw new Error('the A/A copy is not byte-identical');
console.log('arms (all production min bundles):');
for (const [k, f] of Object.entries(ARMS)) console.log(`  ${k.padEnd(8)} ${sha(f)}  ${f.replace(root, '')}`);
console.log(`plant: ${K} counted iterations into a global sink in each of the reference's 2 get traps\n`);

const driver = join(root, 'bench/store-baseline/node.mjs');
const once = (file, mode, gc, extra = []) => JSON.parse(execFileSync(process.execPath, [...(gc ? ['--expose-gc'] : []), driver, file, mode, ...extra], { cwd: root, encoding: 'utf8', timeout: 600000 }).trim().split('\n').pop()).result;
/** Reps calibrated ONCE per row on the REFERENCE, then the same for every arm (per-arm calibration gives a slower arm fewer reps, so less tier-up inside its sample). */
const repsFile = join(work, 'reps-node.json');
const repsTable = once(ref, 'calibrate');
writeFileSync(repsFile, JSON.stringify(repsTable));
console.log('reps per row (calibrated once on the reference, used by every arm):');
for (const [k, n] of Object.entries(repsTable)) console.log(`  ${String(n).padStart(6)}  ${k}`);
const names = Object.keys(ARMS);
const R = Object.fromEntries(names.map((n) => [n, []]));
for (let r = 0; r < rounds; r++) {
  const order = names.map((_, i) => names[(i + r) % names.length]);
  for (const n of r % 2 ? order.reverse() : order) R[n].push(once(ARMS[n], 'rows', false, [repsFile]).rows);
  console.log(`round ${r + 1}/${rounds} done`);
}
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const rows = Object.keys(R.S[0]);
console.log(`\n${'row'.padEnd(64)} ${'S'.padStart(8)} ${'ref'.padStart(8)}   S/ref   A/A    plant/ref  reading`);
for (const row of rows) {
  const v = (n) => R[n].map((x) => x[row].median);
  const s = med(v('S')), f = med(v('ref')), a = med(v('ref A/A')), p = med(v('plant'));
  const spread = Math.abs(a / f - 1);
  /** A row whose sample is shorter than the clock can resolve measures ticks, not code: VOID, never read. */
  const shortest = Math.min(...names.flatMap((n) => R[n].map((x) => x[row].sampleMs)));
  if (shortest < 20) { console.log(`${row.padEnd(64)} VOID: a sample of ${shortest.toFixed(1)} ms is under the clock's resolution`); continue; }
  const slowerAll = v('S').every((x, i) => x > v('ref')[i] * (1 + spread));
  const fasterAll = v('S').every((x, i) => x < v('ref')[i] * (1 - spread));
  console.log(`${row.padEnd(64)} ${s.toFixed(3).padStart(8)} ${f.toFixed(3).padStart(8)}   ${(s / f).toFixed(2).padStart(5)}  ${(spread * 100).toFixed(1).padStart(4)}%   ${(p / f).toFixed(2).padStart(6)}     ${slowerAll ? 'GAP (S slower in every process)' : fasterAll ? 'S faster in every process' : 'within the spread / mixed'}`);
}
const plantSeen = ['1 record read, untracked', '4 nested read, 2 hops', '5 array index read, tracked'].every((row) => med(R.plant.map((x) => x[row].median)) > med(R.ref.map((x) => x[row].median)) * 1.03);
console.log(`\nPLANT ${plantSeen ? 'SEEN (≥ +3% on rows 1, 4, 5): the run is valid' : 'NOT SEEN on rows 1, 4, 5: the run is VOID'}`);
console.log('\nallocation per op (bytes, 1e6 iterations, forced gc):');
for (const n of ['S', 'ref']) console.log(`  ${n.padEnd(4)} ${JSON.stringify(once(ARMS[n], 'alloc', true), (k, x) => (typeof x === 'number' ? Number(x.toFixed(3)) : x))}`);
console.log('retained heap per effect tracking 3 keys (bytes):');
for (const n of ['S', 'ref']) console.log(`  ${n.padEnd(4)} ${JSON.stringify(once(ARMS[n], 'mem', true))}`);
