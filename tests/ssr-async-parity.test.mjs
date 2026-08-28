/**
 * **`renderToStringAsync` must produce exactly what `renderToString` does**, for everything the
 * synchronous render can already do.
 *
 * The two chains share what decides *what* to emit — the scanner, the serializer, the instance
 * preparation, the page assembly — and differ only in *when* they may wait. That sharing is the
 * design, and this is the check that it held: every fixture in the suite through both paths, with
 * the markup, styles and title compared.
 *
 * It exists because two paths that must agree forever is the failure this package spent a week
 * deleting. A gate that renders everything both ways is what makes a second path safe rather than a
 * standing invitation to drift.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { renderToString, renderToStringAsync } from '@verajs/ssr/vera';

const dir = new URL('./fixtures/ssr/', import.meta.url);
const fixtures = readdirSync(dir).filter((name) => name.endsWith('.js'));

test('every fixture renders identically through both chains', async () => {
  const differed = [];
  let compared = 0;

  for (const name of fixtures) {
    const url = new URL(name, dir);
    let sync;
    try {
      sync = await renderToString(url);
    } catch {
      /**
       * A fixture the synchronous render refuses has nothing to compare — except an async
       * `connectedCallback`, which it refuses *because* it cannot wait, and which the asynchronous
       * chain exists to accept. That one is checked separately below.
       */
      continue;
    }

    let asyncResult;
    try {
      asyncResult = await renderToStringAsync(url);
    } catch (error) {
      differed.push(`${name}: async threw — ${error.message.slice(0, 70)}`);
      continue;
    }

    compared++;
    if (asyncResult.html !== sync.html) differed.push(`${name}: markup`);
    else if (asyncResult.styles !== sync.styles) differed.push(`${name}: styles`);
    else if (asyncResult.title !== sync.title) differed.push(`${name}: title`);
  }

  assert.ok(compared > 20, `only ${compared} fixtures were comparable — the walk found nothing`);
  assert.deepEqual(
    differed,
    [],
    `the two chains disagreed on ${differed.length} fixture(s):\n  ${differed.join('\n  ')}\n` +
      `(${compared} identical.)`
  );
});

/**
 * The capability itself. An `async connectedCallback` is refused by the synchronous render — its
 * markup would be empty, and saying so is better than shipping it — and awaited by this one.
 */
test('an async connectedCallback is awaited, not refused', async () => {
  const url = new URL('./fixtures/ssr/async-lifecycle-ssr.js', import.meta.url);

  await assert.rejects(
    () => renderToString(url, { tag: 'async-lifecycle-ssr' }),
    /async connectedCallback/,
    'the synchronous render still refuses it, with the same message'
  );

  const { html } = await renderToStringAsync(url, { tag: 'async-lifecycle-ssr' });
  assert.match(html, /after await/, 'and the asynchronous one waits for it');
});

/**
 * Asynchronous renders take a turn each, so one cannot see another's module-level bookkeeping.
 * Concurrency between them is what that costs; correctness is what it buys.
 */
test('overlapping async renders each get their own result', async () => {
  const hello = new URL('./fixtures/ssr/hello-ssr.js', import.meta.url);
  const rows = new URL('./fixtures/ssr/rows-ssr.js', import.meta.url);

  const [baseHello, baseRows] = [
    (await renderToStringAsync(hello, { tag: 'hello-ssr' })).html,
    (await renderToStringAsync(rows, { tag: 'rows-ssr' })).html,
  ];

  const jobs = [];
  for (let round = 0; round < 8; round++) {
    jobs.push(renderToStringAsync(hello, { tag: 'hello-ssr' }).then(({ html }) => ['hello', html]));
    jobs.push(renderToStringAsync(rows, { tag: 'rows-ssr' }).then(({ html }) => ['rows', html]));
  }
  const results = await Promise.all(jobs);
  const wrong = results.filter(([which, html]) => html !== (which === 'hello' ? baseHello : baseRows));
  assert.deepEqual(wrong.map(([which]) => which), [], 'an overlapping render saw another request');
});

/** A failed async render must not stop the ones queued behind it. */
test('a throw does not block the queue', async () => {
  const throws = new URL('./fixtures/ssr/throws-ssr.js', import.meta.url);
  const hello = new URL('./fixtures/ssr/hello-ssr.js', import.meta.url);

  await assert.rejects(() => renderToStringAsync(throws, { tag: 'throws-ssr' }));
  const { html } = await renderToStringAsync(hello, { tag: 'hello-ssr' });
  assert.match(html, /hello-ssr/, 'the next render still ran');
});
