#!/usr/bin/env node
/**
 * **The coverage floor: every byte of core's production bundle is run by some test** (2026-11-11). On demand, not in
 * the gate (whether it joins the gate is Brian's call). It runs the production fast suite with `NODE_V8_COVERAGE` into
 * a temporary directory (about 1 GB: removed at the end, pass or fail), then reads core's bundle per BYTE: a byte is
 * dead only if, in every process that loaded the bundle, the innermost coverage range holding it counted 0 (V8 bounds
 * its ranges differently per process, so ranges cannot be matched by offset). It prints the dead spans of 12 bytes or
 * more, each mapped to its source line, and exits 1 if any is not in KNOWN.
 *
 *   node scripts/coverage-floor.mjs              the run
 *   node scripts/coverage-floor.mjs --self-check the control: a planted dead branch must be found, a live one must not
 *
 * Under coverage, V8 compiles block counters into every function, so the two inlining-budget tests read longer
 * bytecode and fail there; they pass in the plain suite. Those two failures are expected here, any other is not.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { npmCommand } from './npm.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { heavyBatch } from './heavy-batch.mjs';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

const root = fileURLToPath(new URL('..', import.meta.url));
const BUNDLE = join(root, 'packages/core/dist/vera.min.js');
/** Dead spans that are reported, not tested (source location: why). */
const KNOWN = new Map();
const COVERAGE_ONLY_FAILURES = ['core-inlining-budget.test.mjs', 'ssr-inlining-budget.test.mjs'];

/** The live bytes of `text` from V8 coverage `scripts` (all of them for this bundle): a Uint8Array, 1 = some process ran it. */
export const liveBytes = (text, scripts) => {
  const live = new Uint8Array(text.length);
  for (const script of scripts) {
    const counts = new Int32Array(text.length).fill(-1);
    /** Outer ranges first, inner ranges overwrite: each byte ends with its innermost range's count. */
    const ranges = script.functions.flatMap((fn) => fn.ranges).sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
    for (const r of ranges) counts.fill(r.count, r.startOffset, Math.min(r.endOffset, text.length));
    for (let i = 0; i < text.length; i++) if (counts[i] > 0) live[i] = 1;
  }
  return live;
};
/** The dead spans `[start, end)` of 12 bytes or more that hold code (a letter), not just punctuation between live code. */
export const deadSpans = (text, live) => {
  const spans = [];
  for (let i = 0; i < text.length; ) {
    if (live[i]) { i++; continue; }
    let j = i;
    while (j < text.length && !live[j]) j++;
    if (j - i >= 12 && /[A-Za-z]/.test(text.slice(i, j))) spans.push([i, j]);
    i = j;
  }
  return spans;
};

if (process.argv.includes('--self-check')) {
  /** A synthetic bundle: one function, whose second branch never runs in the synthetic coverage. */
  const text = 'const f=t=>{if(t)return livePathRuns();return plantedDeadBranchNeverRuns()};';
  const dead = text.indexOf('return plantedDead'), end = text.length - 2;
  const scripts = [{ functions: [{ ranges: [{ startOffset: 0, endOffset: text.length, count: 1 }, { startOffset: dead, endOffset: end, count: 0 }] }] }];
  const spans = deadSpans(text, liveBytes(text, scripts));
  const found = spans.some(([s, e]) => text.slice(s, e).includes('plantedDeadBranchNeverRuns'));
  const clean = !spans.some(([s, e]) => text.slice(s, e).includes('livePathRuns'));
  console.log(`self-check: planted dead branch ${found ? 'FOUND' : 'MISSED'}; live path ${clean ? 'not reported' : 'REPORTED'}`);
  process.exit(found && clean ? 0 : 1);
}

/** A heavy batch (the production suite under coverage): caffeinated, paused, thermal-gated (see `heavy-batch.mjs`). */
heavyBatch('coverage-floor')();
const dir = mkdtempSync(join(tmpdir(), 'vera-coverage-floor-'));
try {
  const run = spawnSync(...npmCommand('npm', ['run', 'test:prod']), { cwd: root, env: { ...process.env, NODE_V8_COVERAGE: dir }, encoding: 'utf8', maxBuffer: 1 << 28 });
  const failing = [...(run.stdout ?? '').matchAll(/^test at tests\/([^:]+):/gm)].map((m) => m[1]);
  const unexpected = [...new Set(failing)].filter((f) => !COVERAGE_ONLY_FAILURES.includes(f) && f !== 'ssr-parse-differential.test.mjs');
  const text = readFileSync(BUNDLE, 'utf8');
  const scripts = readdirSync(dir).flatMap((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')).result ?? []).filter((s) => s.url.endsWith('/packages/core/dist/vera.min.js'));
  if (scripts.length === 0) throw new Error('coverage-floor: no process loaded the bundle; nothing was measured');
  const spans = deadSpans(text, liveBytes(text, scripts));
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const at = (off) => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (lineStarts[m] <= off) lo = m; else hi = m - 1; } return { line: lo + 1, column: off - lineStarts[lo] }; };
  const map = new TraceMap(JSON.parse(readFileSync(`${BUNDLE}.map`, 'utf8')));
  let unknown = 0;
  console.log(`coverage-floor: ${scripts.length} processes loaded core's bundle (${text.length} B); ${spans.length} dead span(s)`);
  for (const [s, e] of spans) {
    const o = originalPositionFor(map, at(s));
    /** The map's sources are relative to the bundle (`../src/…`, `../../shared-utils/src/…`): the leading `../` dropped. */
    const where = `${(o.source ?? '?').replace(/^(\.\.\/)+/, '')}:${o.line}`;
    const why = KNOWN.get(where);
    if (!why) unknown++;
    console.log(`  ${String(e - s).padStart(4)} B  ${where}  ${why ? `(known: ${why})` : 'UNEXPECTED'}  ${text.slice(s, Math.min(e, s + 70))}`);
  }
  if (unexpected.length) console.log(`coverage-floor: unexpected failing suites under coverage: ${unexpected.join(', ')}`);
  process.exitCode = unknown || unexpected.length ? 1 : 0;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
