/**
 * **No server render waits unboundedly on a component's promise.** `renderToStringAsync` awaited an async
 * `connectedCallback` and every promise a frame callback returned with no bound: one that never settled held the
 * request open for ever, and because renders take turns, every request after it too — the server stopped. Now each
 * wait races the render's `timeout` budget (2000 ms by default, from the start of its turn); past it the render serves
 * what it has and warns, in every build. A wait shorter than the budget is still waited for.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToString, renderToStringAsync } from '@verajs/ssr';

const MODULE = new URL('./fixtures/ssr/timeout-ssr.js', import.meta.url);
const timed = async (tag, options) => {
  const warnings = [];
  const { warn } = console;
  console.warn = (message) => warnings.push(String(message));
  const start = performance.now();
  try {
    const result = await renderToStringAsync(MODULE, { tag, ...options });
    return { html: result.html, ms: performance.now() - start, warnings };
  } finally {
    console.warn = warn;
  }
};

test('a never-settling promise from a frame or an async connectedCallback ends at the budget, with one warning', async () => {
  for (const tag of ['never-frame', 'never-connected']) {
    const { html, ms, warnings } = await timed(tag, { timeout: 120 });
    assert.ok(ms >= 110 && ms < 1000, `${tag}: ${ms} ms`);
    assert.ok(html.includes('<p>'), `${tag}: what had rendered is served`);
    assert.equal(warnings.length, 1, `${tag}: ${warnings}`);
    assert.match(warnings[0], new RegExp(`^\\[vera\\] ssr: <${tag}> was served after its 120 ms \`timeout\``));
  }
});

test('a wait shorter than the budget is waited for, and a longer one is cut', async () => {
  const waited = await timed('late-settle', { timeout: 500 });
  assert.ok(waited.html.includes('data-done="late"'), waited.html);
  assert.deepEqual(waited.warnings, []);
  const cut = await timed('late-settle', { timeout: 10 });
  assert.ok(cut.html.includes('data-done="early"'), cut.html);
  assert.equal(cut.warnings.length, 1);
});

test('a rejection inside the budget still fails the render, as before', async () => {
  await assert.rejects(renderToStringAsync(MODULE, { tag: 'late-reject', timeout: 500 }), /late-reject/);
});

/** `0` is not "no limit" (there is no such setting): it waits for nothing, so even a short wait is cut, and said. */
test('`timeout: 0` waits for nothing', async () => {
  const { html, ms, warnings } = await timed('late-settle', { timeout: 0 });
  assert.ok(html.includes('data-done="early"') && ms < 50, `${ms} ms: ${html}`);
  assert.match(warnings[0], /after its 0 ms `timeout`/);
});

test('the default budget is 2000 ms', async () => {
  const { ms, warnings } = await timed('never-frame', {});
  assert.ok(ms >= 1990 && ms < 3500, `${ms} ms`);
  assert.match(warnings[0], /after its 2000 ms `timeout`/);
});

test('renders take turns, and each budget starts at its own turn', async () => {
  const start = performance.now();
  const ends = [];
  await Promise.all([
    renderToStringAsync(MODULE, { tag: 'never-frame', timeout: 150 }).then(() => ends.push(performance.now() - start)),
    renderToStringAsync(MODULE, { tag: 'never-frame', timeout: 100 }).then(() => ends.push(performance.now() - start)),
  ].map((p) => p.catch(() => {})));
  assert.ok(ends[0] >= 140 && ends[1] - ends[0] >= 90, `ends at ${ends.map(Math.round)} ms`);
});

test('`timeout` is checked: a number of milliseconds from 0 to 2^31 − 1', async () => {
  for (const bad of ['500', -1, Number.POSITIVE_INFINITY, 2 ** 31, Number.NaN])
    await assert.rejects(renderToStringAsync(MODULE, { tag: 'never-frame', timeout: bad }), /`timeout` must be a number of milliseconds/, String(bad));
});

test('a synchronous render is untouched: it awaits nothing, and accepts the option', async () => {
  const { html } = await renderToString(MODULE, { tag: 'never-frame', timeout: 1 });
  assert.ok(html.includes('<p>frame</p>'));
});
