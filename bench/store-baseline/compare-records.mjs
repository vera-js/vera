/**
 * **The hook-record race** (2026-10-26): (a) class, (b) object with method fields, (c) data-only + kind table, and a
 * byte A/A of (a) — production min bundles built in the experiment tree, ONE process per variant, reps calibrated once
 * on (a) (warm, ×2) and used by every arm, 3 rounds in rotated order; then retained memory per hook with handles dropped
 * and kept. Usage: node bench/store-baseline/compare-records.mjs <dir> [rounds=3] [base,other,…] — `<dir>` holds each
 * variant's build as `dist-<name>/vera.min.js`; the FIRST variant is the base (calibrated on, its byte A/A staged); the
 * default variants are a,b,c.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fsPath } from '../../scripts/fs-path.mjs';
const root = fsPath(new URL('../../', import.meta.url));
const P = process.argv[2];
if (!P) throw new Error('usage: compare-records.mjs <dir> [rounds] [base,other,…]');
const rounds = Number(process.argv[3] ?? 3);
const variants = (process.argv[4] ?? 'a,b,c').split(',');
const base = variants[0];
const aa = join(P, `${base}-aa.min.js`);
rmSync(aa, { force: true });
writeFileSync(aa, readFileSync(join(P, `dist-${base}/vera.min.js`)));
const AA = `${base} A/A`;
const ARMS = { [base]: join(P, `dist-${base}/vera.min.js`), [AA]: aa, ...Object.fromEntries(variants.slice(1).map((v) => [v, join(P, `dist-${v}/vera.min.js`)])) };
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 12);
for (const [k, f] of Object.entries(ARMS)) console.log(`  ${k.padEnd(6)} ${sha(f)}  ${f.replace(root, '')}`);
const driver = join(root, 'bench/store-baseline/node.mjs');
const once = (file, mode, gc, extra = []) => JSON.parse(execFileSync(process.execPath, [...(gc ? ['--expose-gc'] : []), driver, file, mode, ...extra], { cwd: root, encoding: 'utf8', timeout: 600000 }).trim().split('\n').pop()).result;
const repsFile = join(P, 'reps.json');
/** `ROWS=store` races the store bench's rows (rows.mjs) instead of the hook rows; the same arms, reps and reading. */
const store = process.env.ROWS === 'store';
writeFileSync(repsFile, JSON.stringify(once(ARMS[base], store ? 'calibrate' : 'hookcal')));
const names = Object.keys(ARMS);
/** Fisher–Yates under a small deterministic generator (mulberry32), so a run's order replays from its seed. */
const shuffle = (list, seed) => {
  let t = seed >>> 0;
  const rand = () => { t = (t + 0x6d2b79f5) >>> 0; let x = Math.imul(t ^ (t >>> 15), 1 | t); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
};
const R = Object.fromEntries(names.map((n) => [n, []]));
for (let r = 0; r < rounds; r++) {
  /** A SEEDED SHUFFLE per round, never a rotation: a rotated fixed list keeps every arm beside the same neighbor (the
   *  A/A always ran right after its base), and the A/A then read slower than its own bytes in 5 of 5 rounds (2026-10-26). */
  const order = shuffle(names, 0x9e3779b9 ^ (r + 1));
  console.log(`round ${r + 1} order: ${order.join(', ')}`);
  for (const n of order) R[n].push(once(ARMS[n], store ? 'rows' : 'hooks', false, [repsFile]).rows);
  console.log(`round ${r + 1}/${rounds} done`);
}
/** Every round's per-row medians, per arm: the paired per-round reading a median alone cannot give. */
writeFileSync(join(P, `rounds-${store ? 'store' : 'hooks'}.json`), JSON.stringify(Object.fromEntries(names.map((n) => [n, R[n].map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, v.median])))]))));
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const others = variants.slice(1);
console.log(`\n${'row'.padEnd(46)} ${base.padStart(8)}  ${others.map((o) => `${o}/${base}`.padStart(7)).join(' ')}   A/A`);
for (const row of Object.keys(R[base][0])) {
  const v = (n) => R[n].map((x) => x[row].median);
  const a = med(v(base));
  const shortest = Math.min(...names.flatMap((n) => R[n].map((x) => x[row].sampleMs)));
  if (shortest < 20) { console.log(`${row.padEnd(46)} VOID (a ${shortest.toFixed(1)} ms sample)`); continue; }
  const spread = Math.abs(med(v(AA)) / a - 1);
  /** A row whose byte-identical A/A differs by more than 3% cannot resolve a change: VOID, never read. */
  if (spread > 0.03) { console.log(`${row.padEnd(46)} VOID (A/A ${(spread * 100).toFixed(1)}%)`); continue; }
  const tag = (n) => (v(n).every((x, i) => x > v(base)[i] * (1 + spread)) ? '↑' : v(n).every((x, i) => x < v(base)[i] * (1 - spread)) ? '↓' : ' ');
  console.log(`${row.padEnd(46)} ${a.toFixed(4).padStart(8)}  ${others.map((o) => `${(med(v(o)) / a).toFixed(3)}${tag(o)}`.padStart(7)).join(' ')}  ${(spread * 100).toFixed(1)}%`);
}
console.log(`(↑ slower than (${base}) in every round beyond the A/A; ↓ faster in every round)\n\nretained memory per hook:`);
if (!store) for (const n of variants) console.log(`  ${n}  ${JSON.stringify(once(ARMS[n], 'hookmem', true), (k, x) => (typeof x === 'number' ? Math.round(x) : x))}`);
