/**
 * **`requestAnimationFrame` ids on the server are the platform's: unique, never reused, and canceled by id.** The
 * shim handed out QUEUE POSITIONS, which restarted at 1 after every drain: a component canceling its own finished
 * frame deleted whichever callback now sat at that position (another component's work), a cancel from inside a frame
 * never reached a callback of the same frame, and ids repeated. jsdom, with real frames, is the reference for the
 * same scenarios (`fixtures/ssr/frame-scenarios.js`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { scenarios } from './fixtures/ssr/frame-scenarios.js';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
const reference = [];
scenarios((fn) => dom.window.requestAnimationFrame(fn), (id) => dom.window.cancelAnimationFrame(id), reference);
await new Promise((resolve) => setTimeout(resolve, 200));
const { renderToString } = await import('@verajs/ssr');

test('stale and same-frame cancels, and unique ids, behave as with real frames', async () => {
  /** The reference ran: a canceled callback is missing from it and a surviving one present, or the rows mean nothing. */
  assert.deepEqual([...reference].sort(), ['a', 'b', 'unique', 'x']);
  globalThis.__frameLog = [];
  await renderToString(new URL('./fixtures/ssr/frame-ids-ssr.js', import.meta.url), {});
  assert.deepEqual([...globalThis.__frameLog].sort(), [...reference].sort());
});

test('an idle callback and a frame are canceled only by their own cancel', () => {
  const ran = [];
  const frame = requestAnimationFrame(() => ran.push('frame'));
  const idle = requestIdleCallback(() => ran.push('idle'));
  assert.notEqual(frame, idle);
  cancelIdleCallback(frame);
  cancelAnimationFrame(idle);
  cancelAnimationFrame(12345);
  /** Drained by the next render's flush; scheduled outside one here, so run them through a render. */
  return renderToString(new URL('./fixtures/ssr/frame-ids-ssr.js', import.meta.url), {}).then(() => {
    assert.ok(ran.includes('frame') && ran.includes('idle'), `the wrong-kind cancels canceled nothing: ${ran}`);
  });
});
