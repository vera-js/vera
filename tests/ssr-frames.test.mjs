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
