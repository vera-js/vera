/**
 * **Frames on the server** — `requestAnimationFrame` work a component schedules while it renders.
 *
 * A server has no display, so the frames a render schedules are drained before its markup is read: a
 * bounded number of rounds synchronously, and in an async render until the work has gone idle. Each
 * rule below is one way a component's frame work reaches a server that never paints — an animation
 * loop, fire-and-forget promise work, an awaited timer — and what the render must do with it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToString, renderToStringAsync } from '@verajs/ssr';

const fixture = (name) => new URL(`./fixtures/ssr/frames/${name}.js`, import.meta.url);

/**
 * An animation loop reschedules itself from inside every frame. Draining "until there are no frames"
 * never ends on one, and the request hangs; the drain is bounded instead, and the markup ships.
 */
test('a frame that reschedules itself forever still renders, in bounded rounds', async () => {
  const { runs } = await import(fixture('raf-loop'));
  const { html } = await renderToString(fixture('raf-loop'));
  assert.match(html, /<p>looping<\/p>/);
  assert.ok(runs.count > 0 && runs.count <= 100, `ran ${runs.count} rounds, bounded`);
});

/**
 * The loop leaves one callback queued when the bound stops it. That callback belongs to a render that
 * has finished; running it during the NEXT component's drain executes one request's code in another's.
 */
test('a runaway loop\'s leftover frame does not run during the next render', async () => {
  const { runs } = await import(fixture('raf-loop'));
  await renderToString(fixture('raf-loop'));
  const after = runs.count;
  const { html } = await renderToString(fixture('plain'));
  assert.match(html, /<p>plain<\/p>/, 'CONTROL: the next render rendered');
  assert.equal(runs.count, after, 'the leftover frame never ran');
});

/**
 * Work a frame starts without returning its promise is invisible to the drain except by waiting: the
 * async drain gives the microtask queue three idle turns before it concludes nothing is left. Measured,
 * that reaches a chain four microtasks deep, where one turn reaches two; the fixture sits at three, so
 * it passes with a margin either way and still tells the two apart.
 */
test('async: fire-and-forget work three microtasks deep reaches the markup', async () => {
  const { html } = await renderToStringAsync(fixture('fire-and-forget'));
  assert.match(html, /<p>late<\/p>/);
});

/** A frame that returns a promise is waited for, whatever it awaits — here a timer, not a microtask. */
test('async: a frame callback awaiting a timer is waited for', async () => {
  const { html } = await renderToStringAsync(fixture('awaited-timer'));
  assert.match(html, /<p>late<\/p>/);
});

/**
 * A layout effect's write reaches the markup through BOTH chains, as on the client. Core flushes as a microtask, and
 * each round of a server drain runs core's flush first (2026-10-08) — so the synchronous chain, which serializes
 * without yielding, settles the same markup as the asynchronous one. Before, it serialized first and kept `start`.
 */
test('a layout effect reaches the markup through both chains, as on the client', async () => {
  const sync = await renderToString(fixture('layout-effect'));
  assert.match(sync.html, /<p>layout-ran<\/p>/, 'the synchronous chain settles it too');
  const later = await renderToStringAsync(fixture('layout-effect'));
  assert.match(later.html, /<p>layout-ran<\/p>/);
});

/**
 * **A component whose effect settles it over several steps reaches its final state on the server — at once.** Its
 * later runs are HELD for a frame (a hook runs at most twice per flush). On the server the frame is the shim's, which
 * the drain runs; the held path's fallback timer (~100 ms) must never be what the server waits on, or every such
 * component would cost a request hundreds of milliseconds (vera-5a's check, 2026-10-08).
 */
test('a self-settling component reaches its final state through both chains, without waiting on the timer', async () => {
  const start = performance.now();
  const sync = await renderToString(fixture('self-settling'));
  const later = await renderToStringAsync(fixture('self-settling'));
  const elapsed = performance.now() - start;
  assert.match(sync.html, /<p>settled-5<\/p>/, 'the synchronous chain settled it');
  assert.match(later.html, /<p>settled-5<\/p>/, 'and the asynchronous one');
  assert.ok(elapsed < 150, `both renders took ${elapsed.toFixed(0)} ms — a held run waited on the ~100 ms timer`);
});
