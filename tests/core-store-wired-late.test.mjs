/**
 * **A value read before its module was wired stays as it was handed back: a documented limit, said in development**
 * (D26, Brian's ruling 2026-11-11). A Map nested in a store, read while nothing claims Maps, is handed back as it is
 * and remembered so; wiring `collections` afterwards reaches only values not read yet (a store made from the Map itself
 * is the exception: it is re-decided in place). Fixing it for production would hold a reference per unclaimed value
 * forever, so development says so instead, once per type, when the claiming module is wired (`wired-late`).
 * PIN: the pre-read Map is not reactive after the wire. CONTROL: a Map first read after the wire is.
 * Each case runs in a process of its own: wiring is global.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { isProduction } from './dist.mjs';

const run = (body) => {
  const out = execFileSync(process.execPath, [...(isProduction ? [] : ['--conditions', 'development']), '--input-type=module', '-e', `
    const { load } = await import('./tests/dist.mjs');
    const { createStore, effect, wire } = await load('core');
    const { collections } = await load('store/collections');
    const said = [];
    const error = console.error; console.error = (line) => said.push(String(line));
    const reads = (map) => { let runs = 0; effect(() => { void map.get(1); runs++; }, { owner: {}, timing: 'sync' }).run(); return () => runs - 1; };
    ${body}
    console.error = error;
  `], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env } });
  return JSON.parse(out.trim().split('\n').pop());
};

test('PIN: a nested Map read before collections is wired stays as it was; development says so once', () => {
  const out = run(`
    const s = createStore({ m: new Map([[1, 1]]) });
    const before = s.m;
    wire([collections]);
    wire([collections]);
    const woke = reads(s.m);
    s.m.set(1, 2);
    console.log(JSON.stringify({ same: s.m === before, woke: woke(), said: said.filter((l) => l.includes('wired-late')).length, named: said.some((l) => l.includes('wired-late') && l.includes('Map')) }));
  `);
  assert.equal(out.same, true, 'still the object it was handed back as');
  assert.equal(out.woke, 0, 'not reactive after the wire (the documented limit)');
  assert.equal(out.said, isProduction ? 0 : 1, 'development says so once');
  if (!isProduction) assert.equal(out.named, true, 'naming the type');
});

test('CONTROL: a nested Map first read after the wire is reactive, and nothing is said', () => {
  const out = run(`
    const s = createStore({ m: new Map([[1, 1]]) });
    wire([collections]);
    const woke = reads(s.m);
    s.m.set(1, 2);
    console.log(JSON.stringify({ woke: woke(), said: said.filter((l) => l.includes('wired-late')).length }));
  `);
  assert.equal(out.woke, 1);
  assert.equal(out.said, 0);
});
