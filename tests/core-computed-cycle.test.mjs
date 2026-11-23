/**
 * **A computed that reads itself throws `computed-cycle` in development** (2026-11-23). Read from plain code, its
 * function ran, read the computed again, and ran again, until the stack overflowed (`RangeError: Maximum call stack
 * size exceeded`), where TC39's `Signal.Computed`, which a pulled read follows, throws a cycle error; read by an effect,
 * it re-ran about 1200 times a write. Development now throws a coded `TypeError` naming the cycle on both paths.
 * Production is unchanged (Brian's ruling: a guard on either path cost a core read path 1–13% in one engine), and its
 * rows pin what it does, so a change there is seen. A throw from the function itself still reaches the reader, and the
 * next read tries again (the control: the mark does not outlive a throw).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { distUrl, load, isProduction } from './dist.mjs';

const core = await load('core');
const { computed, createStore } = core;

const cycleError = (read) => {
  try {
    read();
  } catch (error) {
    return error;
  }
  return undefined;
};

test('a computed that reads itself, directly or through another: computed-cycle in development, the stack overflow in production', () => {
  const self = computed(() => self.value + 1);
  const a = computed(() => b.value + 1);
  const b = computed(() => a.value + 1);
  for (const [label, read] of [
    ['itself', () => self.value],
    ['through another computed', () => a.value],
    ['the other one first', () => b.value],
  ]) {
    const error = cycleError(read);
    if (isProduction) {
      assert.ok(error instanceof RangeError, `${label}: ${error}`);
      continue;
    }
    assert.ok(error instanceof TypeError, `${label}: ${error}`);
    assert.ok(error.message.includes('computed-cycle'), `${label}: ${error.message}`);
    assert.ok(error.message.includes('its own value'), `${label}: ${error.message}`);
  }
});

/**
 * **Watched** (an effect reads it): its own read inside its run subscribes it to itself, and it re-runs about 1200 times
 * a write until the stack overflows, reported as the hook's error each time with the value left wherever the last run
 * reached. In development the read throws `computed-cycle`: the effect's first read throws it, and each later write
 * reports it ONCE through the error chain. Production keeps the runaway, pinned here: more than 100 runs and only
 * stack-overflow errors, through the chain or, once a write's wake loop catches one, reported as uncaught (a hook's
 * error never leaves a write), so production's row runs in a child (the test runner fails a file on an uncaught error).
 */
test('a WATCHED computed that reads itself: computed-cycle once a write in development, the runaway in production', () => {
  if (isProduction) {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', `
const { computed, createStore, effect, wire } = await import(${JSON.stringify(distUrl('core'))});
const names = [];
wire({ on: 'error', fn: (error) => { names.push(error.constructor.name); }, priority: 50 });
process.on('uncaughtException', (error) => names.push(error.constructor.name));
const state = createStore({ n: 1 });
let runs = 0;
const loop = computed(() => { runs++; return state.n + (loop.value ?? 0); });
try { effect(() => { void loop.value; }, { owner: {} })?.run(); } catch (error) { names.push(error.constructor.name); }
await new Promise((resolve) => setTimeout(resolve, 20));
console.log((runs > 100 ? 'runaway' : 'runs ' + runs) + ' ' + [...new Set(names)].join(','));`], { encoding: 'utf8', env: process.env }).trim();
    assert.equal(out, 'runaway RangeError');
    return;
  }
  const { effect, flush, wire } = core;
  const reported = [];
  wire({ on: 'error', fn: (error) => { reported.push(error); }, priority: 50 });
  const state = createStore({ n: 1 });
  let runs = 0;
  const loop = computed(() => { runs++; return state.n + (loop.value ?? 0); });
  const first = cycleError(() => effect(() => { void loop.value; }, { owner: {} })?.run());
  const thrown = first ?? reported.shift();
  assert.ok(thrown instanceof TypeError && thrown.message.includes('computed-cycle'), String(thrown));
  assert.equal(runs, 1, 'one run, not a runaway');
  for (const n of [2, 3]) {
    reported.length = 0;
    const before = runs;
    state.n = n;
    flush();
    assert.ok(runs - before <= 1, `write ${n}: ${runs - before} runs`);
    assert.ok(reported.every((e) => e instanceof TypeError && e.message.includes('computed-cycle')), reported.map(String).join(' | '));
  }
});

test('CONTROL: a function that throws reaches the reader, and the next read evaluates again', () => {
  const state = createStore({ n: 1 });
  let calls = 0;
  const flaky = computed(() => {
    calls++;
    if (calls === 1) throw new Error('first');
    return state.n * 2;
  });
  assert.equal(cycleError(() => flaky.value)?.message, 'first');
  assert.equal(flaky.value, 2, 'the second read is no cycle: the throw cleared the mark');
  assert.equal(calls, 2);
  assert.equal(flaky.value, 2, 'cached until a write');
  assert.equal(calls, 2);
});

test('CONTROL: a computed that reads another, no cycle, is unchanged', () => {
  const state = createStore({ n: 3 });
  const double = computed(() => state.n * 2);
  const plus = computed(() => double.value + 1);
  assert.equal(plus.value, 7);
  state.n = 4;
  assert.equal(plus.value, 9);
});
