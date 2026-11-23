/**
 * **A component whose `connectedCallback` throws is named** (2026-11-23). The README promises `ssr-render-threw` for
 * "a throwing hook or connectedCallback", but only a frame's throw reached that wrap: a callback's own throw rejected
 * the render with the bare error, so a page of components said nothing about which one failed (`<x-nest>` holding a
 * throwing `<x-fail>` came back as just its message). Now the thrower is named — the inner tag, not the page's — and
 * its error is the cause, the identical object; in the async chain too, where a sibling prepared while the callback
 * awaited must not take its name. A frame's throw is named as before, and the next render starts clean.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const { renderToString, renderToStringAsync } = await import('@verajs/ssr');
/** In their own folder: `ssr-async-parity` renders every fixture in `fixtures/ssr/`, and these are meant to fail. */
const fixture = (name) => new URL(`./tests/fixtures/ssr-throws/${name}`, pathToFileURL(process.cwd() + '/'));
const healthy = (name) => new URL(`./tests/fixtures/ssr/${name}`, pathToFileURL(process.cwd() + '/'));
const { THROWN } = await import(fixture('connected-throws-ssr.js'));
const { REJECTED } = await import(fixture('connected-rejects-ssr.js'));
const { BUILT } = await import(fixture('constructor-throws-nest-ssr.js'));

/** The error a render rejects with, or a failure if it resolved. */
const rejection = async (render) => {
  try {
    await render();
  } catch (error) {
    return error;
  }
  assert.fail('the render resolved');
};

test('a connectedCallback that throws is named, sync and async, with its error as the cause', async () => {
  for (const render of [renderToString, renderToStringAsync]) {
    const error = await rejection(() => render(fixture('connected-throws-ssr.js'), { tag: 'connected-throws-ssr' }));
    assert.match(error.message, /\(ssr-render-threw\)/, `${render.name}: ${error.message}`);
    assert.match(error.message, /<connected-throws-ssr> threw while rendering/, render.name);
    assert.equal(error.cause, THROWN, `${render.name}: the cause is the identical error`);
  }
});

test('a nested component that throws is named by its own tag, not the page', async () => {
  for (const render of [renderToString, renderToStringAsync]) {
    const error = await rejection(() => render(fixture('connected-throws-nest-ssr.js'), { tag: 'connected-throws-nest-ssr' }));
    assert.match(error.message, /<connected-throws-ssr> threw while rendering/, `${render.name}: ${error.message}`);
    assert.equal(error.cause, THROWN, render.name);
  }
});

test('a nested component whose constructor throws is named by its own tag, sync and async', async () => {
  for (const render of [renderToString, renderToStringAsync]) {
    const error = await rejection(() => render(fixture('constructor-throws-nest-ssr.js'), { tag: 'constructor-throws-nest-ssr' }));
    assert.match(error.message, /<constructor-throws-ssr> threw while rendering/, `${render.name}: ${error.message}`);
    assert.equal(error.cause, BUILT, `${render.name}: the cause is the identical error`);
  }
});

test('async: a rejecting callback is named even when a sibling was prepared while it awaited', async () => {
  const error = await rejection(() => renderToStringAsync(fixture('connected-rejects-ssr.js'), { tag: 'connected-rejects-nest-ssr' }));
  assert.match(error.message, /<connected-rejects-ssr> threw while rendering/, error.message);
  assert.equal(error.cause, REJECTED, 'the cause is the identical error');
});

test("CONTROL: a frame's throw is named as before, and the next render starts clean", async () => {
  const frame = await rejection(() => renderToString(healthy('throws-ssr.js'), { tag: 'throws-ssr' }));
  assert.match(frame.message, /<throws-ssr> threw while rendering/, frame.message);
  assert.ok(frame.cause instanceof Error, 'a frame throw carries its cause');
  const after = await renderToString(healthy('content-ssr.js'), { tag: 'content-page' });
  assert.ok(typeof after.html === 'string' && after.html.length > 0, 'a healthy render right after');
  assert.doesNotMatch(after.html, /boom/, 'nothing of the failed render leaks into the next');
});
