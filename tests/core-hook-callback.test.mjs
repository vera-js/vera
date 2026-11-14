/**
 * **A hook's callback that is not a function is refused AT THE CALL, in both builds** (Brian's ruling, 2026-11-14).
 * `effect(undefined)` used to register and fail at its first run, far from the call that made it, and core's immediate
 * hook (`createHook`) returned `undefined` silently: the same mistake, two outcomes. Both now throw a `TypeError` coded
 * `callback-not-function` before anything is registered; the owner check still comes first (`no-owner`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './dist.mjs';

const core = await load('core');
const createHook = core.inserts.$s[2];
const NOT_FUNCTIONS = [['undefined', undefined], ['null', null], ['a number', 123], ['an object', { run() {} }], ['a string', 'fn']];

const throwsAtCall = (make, label) => {
  let error;
  try { make(); } catch (e) { error = e; }
  assert.ok(error instanceof TypeError, `${label}: a TypeError at the call (got ${error})`);
  assert.match(String(error.message), /callback-not-function/, `${label}: coded callback-not-function`);
};

test('effect(notAFunction) throws at the call, coded, before registering anything', () => {
  for (const [label, value] of NOT_FUNCTIONS) {
    const owner = {};
    throwsAtCall(() => core.effect(value, { owner }), `effect(${label})`);
  }
});

test('createHook({ callback: notAFunction }) throws at the call, coded (it returned undefined silently before)', () => {
  for (const [label, value] of NOT_FUNCTIONS) {
    const element = {};
    throwsAtCall(() => createHook({ element, priority: 50, callback: value }), `createHook(${label})`);
  }
});

test('the owner is checked first: no owner and no callback is no-owner, as before', () => {
  assert.throws(() => core.effect(undefined), /no-owner/);
  assert.throws(() => createHook({ priority: 50, callback: undefined }), /no-owner/);
});

test('control: a function is accepted by both, so the refusals above are about the callback alone', () => {
  const owner = {};
  const box = core.effect(() => {}, { owner });
  assert.equal(typeof box?.run, 'function', 'effect(fn) returns the effect');
  box.stop();
  const run = createHook({ element: {}, priority: 50, callback: () => {} });
  assert.equal(typeof run, 'function', 'createHook hands back its runner');
});
