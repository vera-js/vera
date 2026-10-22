/**
 * The child for `tests/ssr-release.test.mjs`: one MODE per process, gc as the instrument (run with `--expose-gc`), the
 * retained control (`kept`) and the dropped control (`dropped`) reported beside every count.
 */
import { renderToString, renderToStringAsync } from '@verajs/ssr';
const mode = process.argv[2];
const N = 200;
const keptRef = new WeakRef((globalThis.__kept = { kept: true }));
const droppedRef = (() => new WeakRef({ dropped: true }))();
const { flush } = await import('@verajs/core');
/**
 * **The scheduler is DRAINED before anything is counted** (2026-10-22). A flush past its 4 ms frame budget defers the rest
 * to the next frame or, on a server, a 100 ms fallback timer, and what it still holds stays reachable until that fires.
 * Under a full gate's load 200 concurrent renders crossed the budget: "2 alive" (overlap) and "3 alive" (define-props),
 * each gone 250 ms later (`aliveAfterWait: 0`) — timing survivors, never seen standalone. A retention count measures
 * what is LEFT once nothing is pending, so it drains first.
 */
const gc = async () => { flush(); for (let i = 0; i < 6; i++) { global.gc(); await new Promise((r) => setImmediate(r)); } };
const url = (f) => new URL(`./${f}`, import.meta.url);
const out = { mode };
if (mode === 'sync' || mode === 'overlap' || mode === 'async-hook' || mode === 'define-sync' || mode === 'define-props' || mode === 'define-async') {
  let markup = '';
  if (mode === 'sync' || mode === 'define-sync' || mode === 'define-props') for (let i = 0; i < N; i++) { markup = (await renderToString(url(mode === 'sync' ? 'comp.mjs' : mode === 'define-props' ? 'comp-define-props.mjs' : 'comp-define.mjs'))).html; if (i % 50 === 49) await new Promise((r) => setImmediate(r)); }
  else {
    const page = mode === 'overlap' ? 'comp.mjs' : mode === 'define-async' ? 'comp-define-async.mjs' : 'comp-async.mjs';
    const all = await Promise.all(Array.from({ length: N }, () => renderToStringAsync(url(page))));
    markup = all[N - 1].html;
  }
  await gc();
  const refs = globalThis.__refs ?? [];
  Object.assign(out, { rendered: refs.length, markup: markup.includes('<b>0</b>'), late: markup.includes('<i>late</i>'), alive: refs.filter((r) => r.deref() !== undefined).length });
  /**
   * EVIDENCE when it fails (2026-10-22; vera-5a — an intermittent "3 alive" was seen once in three full gates and never
   * standalone): a heap snapshot to name the retainer, and a recount after the 100 ms fallback timer and another gc.
   * Gone after the wait is a TIMING survivor (a pending server-side callback); still there is structural. Costs
   * nothing when green.
   */
  if (out.alive > 0) {
    const { writeHeapSnapshot } = await import('node:v8');
    const { tmpdir } = await import('node:os');
    out.snapshot = writeHeapSnapshot(`${tmpdir()}/vera-ssr-release-${mode}-${process.pid}.heapsnapshot`);
    await new Promise((r) => setTimeout(r, 250));
    await gc();
    out.aliveAfterWait = refs.filter((r) => r.deref() !== undefined).length;
  }
}
if (mode === 'burst') {
  /** 50 renders at once, each writing the store in its setup: no render may re-run once its turn has ended. */
  await Promise.all(Array.from({ length: 50 }, () => renderToStringAsync(url('comp-burst.mjs'))));
  const runs = globalThis.__runs ?? [];
  Object.assign(out, { rendered: runs.length, extraRuns: runs.reduce((n, r) => n + (r.runs - 1), 0), minRuns: Math.min(...runs.map((r) => r.runs)) });
}
if (mode === 'lazy') {
  const first = (await renderToStringAsync(url('comp-lazy.mjs'))).html;
  const { L } = await import('./lazy.mjs');
  L.n = 21;
  flush(); await new Promise((r) => setTimeout(r, 0)); flush();
  const second = (await renderToStringAsync(url('comp-lazy.mjs'))).html;
  Object.assign(out, { first: first.includes('<i>2</i>'), second: second.includes('<i>42</i>') });
}
await gc();
Object.assign(out, { kept: keptRef.deref() !== undefined, droppedDied: droppedRef.deref() === undefined });
process.stdout.write(JSON.stringify(out));
