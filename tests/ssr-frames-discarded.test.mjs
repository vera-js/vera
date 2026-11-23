/**
 * **A frame left queued by a failed render is dropped, never run in the next one** (2026-11-23). Frames drain after a
 * component's `connectedCallback` returns, so one requested before the callback threw never drained: it ran inside the
 * next render instead, with that render's document (writing its title from the failed render's location) and, if it
 * threw, failing that render in its own component's name. The README promises leftover frames are dropped. Sync and
 * async chains alike; a frame requested in a healthy render still runs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const { renderToString, renderToStringAsync } = await import('@verajs/ssr');
const at = (path) => new URL(`./tests/fixtures/${path}`, pathToFileURL(process.cwd() + '/'));
const { RAN } = await import(at('ssr-throws/frame-then-throws-ssr.js'));

/** Request A fails with a frame queued; request B is a healthy page at another location. */
const twoRequests = async (render) => {
  await assert.rejects(() => Promise.resolve(render(at('ssr-throws/frame-then-throws-ssr.js'), { tag: 'frame-then-throws-ssr', location: '/account/a' })), /frame-then-throws-ssr/);
  return render(at('ssr/content-ssr.js'), { tag: 'content-page', location: '/public/b' });
};

test("a failed render's queued frame never runs in the next render: its title is the next page's own", async () => {
  for (const render of [renderToString, renderToStringAsync]) {
    RAN.length = 0;
    const next = await twoRequests(render);
    assert.equal(next.title, '', `${render.name}: the next page's title (${next.title})`);
    assert.deepEqual(RAN, [], `${render.name}: the frame never ran`);
    assert.ok(next.html.length > 0, `CONTROL: ${render.name} rendered the next page`);
  }
});

test("a failed render's queued frame that throws does not fail the next render", async () => {
  globalThis.frameThenThrowsBoom = true;
  try {
    for (const render of [renderToString, renderToStringAsync]) {
      RAN.length = 0;
      const next = await twoRequests(render);
      assert.ok(next.html.length > 0, `${render.name}: the next page resolved`);
      assert.deepEqual(RAN, [], `${render.name}: the frame never ran`);
    }
  } finally {
    globalThis.frameThenThrowsBoom = false;
  }
});
