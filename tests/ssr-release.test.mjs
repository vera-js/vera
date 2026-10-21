/**
 * **A server render's links end with it** (step 2 (a), 2026-10-21). The cells engine links strongly, so a module-scope
 * store read by a server-rendered component kept that component alive for the life of the process — 200 of 200 renders
 * retained, where the weak-linked engine kept none. `@verajs/ssr` now opens a turn per render and core unlinks, when it
 * closes, every hook the render's TREE created (inside a running hook or a setup, or owned by a node).
 *
 * RETENTION is measured in a child process run with `--expose-gc` — the one exception to "tests do not force collection"
 * (CLAUDE.md): gc is the instrument, alone in its own process, with a retained and a dropped control beside every count.
 * The rows, each with the mutation that turned it red when it was written:
 * - sync renders release (no turn close: 200/200);
 * - overlapping async renders release (SSR serializes turns; proven, not read);
 * - an async setup that creates an element-owned hook AFTER an await releases — only the owner marks it born (without the
 *   node-owner clause: 200/200);
 * - a module first imported DURING a render (a lazy `import()`) keeps its module-scope computed live across requests
 *   (pushing every hook created in the turn: the second request served the first one's value);
 * - the unlink is DEFERRED to the next task (the page is served first), and the turn's hooks are inert AT ONCE, so a
 *   burst of renders writing the store re-runs no earlier, discarded render (without the generation bump: re-runs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { isProduction } from './dist.mjs';

const measure = (mode) =>
  JSON.parse(execFileSync(process.execPath, [...(isProduction ? [] : ['--conditions', 'development']), '--expose-gc', '--no-warnings', new URL('./fixtures/ssr-release/measure.mjs', import.meta.url).pathname, mode], { encoding: 'utf8' }));

const controls = (r) => assert.ok(r.kept && r.droppedDied, `CONTROLS: the kept object lived and the dropped one died (${JSON.stringify(r)})`);

test('200 server renders against a module-scope store leave no component alive', () => {
  const r = measure('sync');
  controls(r);
  assert.ok(r.rendered === 200 && r.markup, `CONTROL: 200 renders ran and wrote the value (${JSON.stringify(r)})`);
  assert.equal(r.alive, 0, `${r.alive} rendered components still alive`);
});

test('200 async renders started together leave no component alive', () => {
  const r = measure('overlap');
  controls(r);
  assert.ok(r.rendered === 200 && r.markup, `CONTROL: 200 renders ran and wrote the value (${JSON.stringify(r)})`);
  assert.equal(r.alive, 0, `${r.alive} rendered components still alive`);
});

test('an async setup that creates a hook AFTER an await releases its component too', () => {
  const r = measure('async-hook');
  controls(r);
  assert.ok(r.rendered === 200 && r.markup, `CONTROL: 200 renders ran and wrote the value (${JSON.stringify(r)})`);
  assert.equal(r.alive, 0, `${r.alive} rendered components still alive`);
});

test('a module first imported during a render keeps its module-scope computed live for later requests', () => {
  const r = measure('lazy');
  controls(r);
  assert.ok(r.first, `CONTROL: the first request rendered the computed's value (${JSON.stringify(r)})`);
  assert.ok(r.second, `the second request served a stale computed (${JSON.stringify(r)})`);
});

test('a burst of renders that write the store: each discarded render stays inert, before its deferred unlink runs', () => {
  const r = measure('burst');
  controls(r);
  assert.ok(r.rendered === 50 && r.minRuns >= 1, `CONTROL: 50 components rendered (${JSON.stringify(r)})`);
  assert.equal(r.extraRuns, 0, `${r.extraRuns} re-runs of components whose render had already ended`);
});

test('the unlink is DEFERRED to the next task: held right after the render, released after one task', () => {
  const r = measure('pin');
  controls(r);
  assert.ok(r.rendered === 1, `CONTROL: one render ran (${JSON.stringify(r)})`);
  assert.equal(r.beforeTask, 1, 'the component is still held before the task boundary (the walk runs after the response)');
  assert.equal(r.afterTask, 0, 'released after one task');
});
