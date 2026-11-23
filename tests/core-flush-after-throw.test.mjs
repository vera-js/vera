/**
 * **A flush that a throw ended strands nothing, and a scheduler replaced during a flush keeps flushing** (2026-11-23).
 *
 * An `'error'` handler that rethrows (`log(e); throw e`) carried the error out of the pass and the flush; the passes
 * queued after it were dropped with the queue but stayed marked queued, so no write could queue them again, and a hook
 * on an UNRELATED signal never ran again. And `setRenderScheduler` called from inside a flush with a scheduler that
 * runs at once set "a flush is coming" while the running flush made the call do nothing, so it was never cleared and
 * nothing rendered again. Each process has one core, so the cases that wire an `'error'` handler run in a child.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { distUrl, load } from './dist.mjs';

const child = (body) =>
  execFileSync(process.execPath, ['--input-type=module', '-e', `const core = await import(${JSON.stringify(distUrl('core'))});\n${body}`], {
    encoding: 'utf8',
    env: process.env,
  }).trim();

/** Three hooks: `a` throws on `s === 1`, `b` reads `s`, `c` reads an unrelated signal. Prints runs after each step. */
const RETHROWS = (handler, drive) => `
const { signal, effect, flush, wire } = core;
wire({ on: 'error', fn: ${handler}, priority: 50 });
const s = signal(0), other = signal(0); let a = 0, b = 0, c = 0;
effect(() => { a++; if (s.value === 1) throw new Error('effect broke'); }, { owner: {} })?.run();
effect(() => { s.value; b++; }, { owner: {} })?.run();
effect(() => { other.value; c++; }, { owner: {} })?.run();
process.on('uncaughtException', () => {});
const out = [];
${drive}
await new Promise((r) => setTimeout(r, 20));
out.push(\`settled \${a}/\${b}/\${c}\`);
console.log(out.join(' '));`;
const BY_FLUSH = `
for (const write of [() => { s.value = 1; other.value = 1; }, () => { s.value = 2; }, () => { other.value = 2; }]) {
  write(); try { flush(); } catch {}
  out.push(\`\${a}/\${b}/\${c}\`);
}`;
const BY_MICROTASK = `
for (const write of [() => { s.value = 1; other.value = 1; }, () => { s.value = 2; }, () => { other.value = 2; }]) {
  write(); await new Promise((r) => setTimeout(r, 20));
  out.push(\`\${a}/\${b}/\${c}\`);
}`;

/**
 * By microtask (a page's flushes) the counts are the control's. Through `flush()`, the error leaves the call and the
 * passes after the failing one are asked of the scheduler: a loop that never yields runs them in its next `flush()`,
 * where `b`'s deferred run and its next write's are one run. Before, `b` and `c` stopped at 1 for good.
 */
test("an 'error' handler that rethrows strands no hook, flushed or by microtask", () => {
  const rethrows = '() => { throw new Error("handler broke"); }';
  assert.equal(child(RETHROWS(rethrows, BY_MICROTASK)), '2/2/2 3/3/2 3/3/3 settled 3/3/3', 'microtask');
  assert.equal(child(RETHROWS(rethrows, BY_FLUSH)), '2/1/1 3/2/2 3/2/3 settled 3/2/3', 'flush()');
  /** CONTROL: a handler that does not rethrow runs everything. */
  for (const drive of [BY_MICROTASK, BY_FLUSH]) assert.equal(child(RETHROWS('() => {}', drive)), '2/2/2 3/3/2 3/3/3 settled 3/3/3');
});

/**
 * **The failing pass was the LAST one queued**: nothing is stranded, and the flush must still end as one that ran out
 * does (queue emptied, no longer flushing). Left flushing, every later flush returns at once and nothing runs again,
 * the worst way this path can fail. A write after it, to an unrelated signal, must run its hook.
 */
test('a rethrown error from the last queued pass leaves later flushes running', () => {
  const body = (handler) => `
const { signal, effect, flush, wire } = core;
wire({ on: 'error', fn: ${handler}, priority: 50 });
const s = signal(0), other = signal(0); let a = 0, c = 0;
effect(() => { other.value; c++; }, { owner: {} })?.run();
effect(() => { a++; if (s.value === 1) throw new Error('effect broke'); }, { owner: {} })?.run();
process.on('uncaughtException', () => {});
const out = [];
s.value = 1; let threw = false; try { flush(); } catch { threw = true; }
out.push(\`\${threw} \${a}/\${c}\`);
other.value = 1; try { flush(); } catch {}
out.push(\`\${a}/\${c}\`);
await new Promise((r) => setTimeout(r, 20));
out.push(\`settled \${a}/\${c}\`);
console.log(out.join(' '));`;
  assert.equal(child(body('() => { throw new Error("handler broke"); }')), 'true 2/1 2/2 settled 2/2');
  /** CONTROL: a handler that does not rethrow; the flush does not throw, and the later write runs the same. */
  assert.equal(child(body('() => {}')), 'false 2/1 2/2 settled 2/2');
});

/**
 * The flush asked for after the throw goes to the scheduler; one that throws then leaves no flush promised, so the next
 * write asks again (a promised flush that never comes is the stall `setRenderScheduler` had, by another door).
 */
test('a scheduler that throws when asked after the throw does not stall later writes', () => {
  /**
   * Call 1 (the first write's) does nothing: that step flushes by hand. Call 2 is `strandedNone`'s, and throws. Later
   * calls run by microtask, and the later steps never flush by hand, so a flush left promised would stall them.
   */
  const drive = `
const { setRenderScheduler, microtask } = core;
let calls = 0;
setRenderScheduler((run) => { calls++; if (calls === 1) return; if (calls === 2) throw new Error('scheduler broke'); microtask(run); });
s.value = 1; other.value = 1;
try { flush(); } catch {}
out.push(\`\${a}/\${b}/\${c}\`);
for (const write of [() => { s.value = 2; }, () => { other.value = 2; }]) {
  write();
  await new Promise((r) => setTimeout(r, 20));
  out.push(\`\${a}/\${b}/\${c}\`);
}
out.push(\`calls \${calls}\`);`;
  assert.equal(child(RETHROWS('() => { throw new Error("handler broke"); }', drive)), '2/1/1 3/2/2 3/2/3 calls 4 settled 3/2/3');
});

/**
 * A scheduler that runs the flush at once runs the rest INSIDE the call that asked for it, so a second failing pass's
 * error comes back there: it is thrown again as uncaught, never dropped, and the first still leaves `flush()`. The
 * write is queued with the scheduler doing nothing, so all three passes wait for the one flush.
 */
test('with a scheduler that runs at once, two rethrown errors both surface and the rest still runs', () => {
  const out = child(`
const { signal, effect, flush, wire, setRenderScheduler } = core;
wire({ on: 'error', fn: (e) => { throw e; }, priority: 50 });
let atOnce = false;
setRenderScheduler((run) => { if (atOnce) run(); });
const s = signal(0); let c = 0;
const seen = [];
process.on('uncaughtException', (e) => seen.push('uncaught ' + e.message));
effect(() => { if (s.value === 1) throw new Error('first'); }, { owner: {} })?.run();
effect(() => { if (s.value === 1) throw new Error('second'); }, { owner: {} })?.run();
effect(() => { s.value; c++; }, { owner: {} })?.run();
s.value = 1;
atOnce = true;
try { flush(); } catch (e) { seen.push('flush ' + e.message); }
await new Promise((r) => setTimeout(r, 20));
console.log(seen.join(', ') + ' | c ' + c);`);
  assert.equal(out, 'flush first, uncaught second | c 2');
});

test('setRenderScheduler from inside a flush, with a scheduler that runs at once, keeps flushing', async () => {
  const { signal, effect, setRenderScheduler, microtask } = await load('core');
  const s = signal(0);
  const t = signal(0);
  let b = 0;
  effect(() => { if (s.value === 1) setRenderScheduler((run) => run()); }, { owner: {} })?.run();
  effect(() => { s.value; t.value; b++; }, { owner: {} })?.run();
  const settle = () => new Promise((r) => setTimeout(r, 20));
  s.value = 1;
  await settle();
  assert.equal(b, 2, 'the write that replaced the scheduler rendered');
  t.value = 1;
  await settle();
  assert.equal(b, 3, 'a later write renders, with no flush() to reset it');
  t.value = 2;
  await settle();
  assert.equal(b, 4);
  setRenderScheduler(microtask);
});
