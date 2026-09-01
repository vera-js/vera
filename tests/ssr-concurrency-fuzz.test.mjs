/**
 * SSR under concurrency: firing N renders together must produce what firing them one at a time does.
 *
 * `@verajs/ssr` keeps its per-render bookkeeping — `renderedTags`, `renderErrors`,
 * `pendingInstances`, `instanceCount`, the style-hoisting state — at **module level**, and serialises
 * every render through a turn queue so no two can see each other's. `index.js` records what happened
 * when that queue covered only the asynchronous entry point: a synchronous render fired inside an
 * async one's suspension window ran to completion on the shared state, and the async render "resumed
 * into the wreckage" with empty markup.
 *
 * **Serial execution is the oracle**, and unusually for a differential test that is the actual
 * contract rather than a second opinion from the same code: whatever a request would render alone is
 * what it must render in a crowd.
 *
 * ## Why this is worth generating rather than enumerating
 *
 * The failure mode is the worst one a server has — **one request's content in another's page** — and
 * it depends on interleaving, which is exactly the dimension a hand-written case fixes by accident.
 * Each batch mixes both entry points at random depths, because the documented failure needed one of
 * each.
 *
 * A cross-request leak is asserted **by name**, separately from the output comparison: a page that
 * merely differs from its serial twin is a bug, and a page containing another request's marker is the
 * specific bug this exists to prevent.
 *
 * ## What the mutations established
 *
 * Removing the turn queue from **both** entry points fails this immediately, with both symptoms the
 * source describes: empty `<template shadowrootmode="open"></template>` for some renders, and for
 * others `data-marker` carrying a *different request's* marker — a real leak, reproduced.
 *
 * Removing it from the **synchronous** entry point alone was **not** caught. These sequences do not
 * reach that condition: after the first render the module is import-cached, so a synchronous render
 * runs to completion without yielding and never lands inside an async render's suspension window.
 * So this suite covers the queue's existence, and not the specific contribution of its synchronous
 * half. Stated rather than implied, because a green run should not be read as covering both.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToString, renderToStringAsync } from '@verajs/ssr';

const asyncFixture = new URL('./fixtures/ssr/concurrent-async-ssr.js', import.meta.url);
const syncFixture = new URL('./fixtures/ssr/concurrent-sync-ssr.js', import.meta.url);

const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);

/** Each entry point gets the fixture it accepts — the synchronous one refuses an async callback. */
const renderOne = (marker, depth, isAsync) =>
  isAsync
    ? renderToStringAsync(asyncFixture, { attributes: { marker, depth: String(depth) } })
    : renderToString(syncFixture, { attributes: { marker, depth: String(depth) } });

const SEEDS = [12, 34, 56, 78, 90, 3141];
const ROUNDS = 6;

test('concurrent renders produce exactly what serial renders produce', async () => {
  const failures = [];
  let batches = 0;
  let renders = 0;

  for (const seed of SEEDS) {
    const random = rng(seed);

    for (let round = 0; round < ROUNDS; round++) {
      batches++;
      const size = 3 + Math.floor(random() * 5);
      const jobs = Array.from({ length: size }, (_, index) => ({
        marker: `s${seed}r${round}n${index}`,
        depth: 1 + Math.floor(random() * 4),
        isAsync: random() < 0.5,
      }));

      /** One at a time — the oracle. */
      const serial = [];
      for (const job of jobs) {
        renders++;
        serial.push(await renderOne(job.marker, job.depth, job.isAsync));
      }

      /** All at once. */
      const concurrent = await Promise.all(jobs.map((job) => renderOne(job.marker, job.depth, job.isAsync)));
      renders += jobs.length;

      jobs.forEach((job, index) => {
        const alone = serial[index].html;
        const crowded = concurrent[index].html;
        const where = `seed ${seed} round ${round} job ${index} (${job.marker}, depth ${job.depth}, ${job.isAsync ? 'async' : 'sync'})`;

        if (alone !== crowded)
          failures.push(
            `${where}\n      alone:    ${alone.replace(/\s+/g, ' ').slice(0, 140)}\n      in a batch: ${crowded.replace(/\s+/g, ' ').slice(0, 140)}`
          );

        /** The specific server failure, named separately from "the output differs". */
        for (const other of jobs)
          if (other.marker !== job.marker && crowded.includes(other.marker))
            failures.push(`${where}: this page contains ${other.marker} — one request's content in another's page`);
      });
    }
  }

  assert.equal(batches, SEEDS.length * ROUNDS, 'the generator did not run the expected number of batches');
  assert.ok(renders > 200, `only ${renders} renders were generated`);
  assert.deepEqual(
    failures.slice(0, 8),
    [],
    `${failures.length} problem(s) across ${renders} renders:\n\n  ${failures.slice(0, 8).join('\n\n  ')}`
  );
});
