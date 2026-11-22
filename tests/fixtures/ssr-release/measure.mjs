/**
 * The child for `tests/ssr-release.test.mjs`: one MODE per process, gc as the instrument (run with `--expose-gc`), the
 * retained control (`kept`) and the dropped control (`dropped`) reported beside every count.
 */
import { renderToString, renderToStringAsync } from '@verajs/ssr';
const mode = process.argv[2];
const N = 200;
const keptRef = new WeakRef((globalThis.__kept = { kept: true }));
const droppedRef = (() => new WeakRef({ dropped: true }))();
const gc = async () => { for (let i = 0; i < 6; i++) { global.gc(); await new Promise((r) => setImmediate(r)); } };
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
  /**
   * **A count that dereferences nothing** (2026-10-22), taken FIRST: live instances of the component's class,
   * as the subscription sweep counts. A WeakRef `deref()` puts its target on V8's keep-during-job list — the capture's
   * only strong root for the intermittent's survivors — so this count cannot keep alive what it measures. Reported
   * beside `alive`; the assertion is unchanged until the two are compared over gates.
   */
  const file = mode === 'sync' || mode === 'overlap' ? 'comp.mjs' : mode === 'async-hook' ? 'comp-async.mjs' : mode === 'define-sync' ? 'comp-define.mjs' : mode === 'define-props' ? 'comp-define-props.mjs' : 'comp-define-async.mjs';
  const Class = (await import(url(file))).default;
  const { queryObjects } = await import('node:v8');
  out.objects = queryObjects(Class, { format: 'count' });
  /**
   * EVIDENCE when an instance survived (2026-11-22): the retainer path, read from a heap snapshot taken BEFORE anything
   * below dereferences a WeakRef (a `deref()` adds a root of its own), and printed with the failure, because a CI
   * runner's snapshot file goes with the runner. The survivors are found as the live targets of `__refs`'s WeakRefs, which
   * holds in the minified build too. One file per mode, overwritten by the next failure.
   */
  if (out.objects > 0) {
    const { writeHeapSnapshot } = await import('node:v8');
    const { tmpdir } = await import('node:os');
    const { retainerPaths } = await import('./retainers.mjs');
    out.snapshot = writeHeapSnapshot(`${tmpdir()}/vera-ssr-release-${mode}.heapsnapshot`);
    out.retainers = retainerPaths(out.snapshot, { weakRefsIn: '__refs' });
  }
  /** Its CONTROL: one instance held must count one more (an instrument that cannot count reports a clean heap). */
  const held = new Class();
  out.objectsControl = queryObjects(Class, { format: 'count' }) - out.objects;
  void held;
  const refs = globalThis.__refs ?? [];
  Object.assign(out, { rendered: refs.length, markup: markup.includes('<b>0</b>'), late: markup.includes('<i>late</i>'), alive: refs.filter((r) => r.deref() !== undefined).length });
  /**
   * EVIDENCE when it fails (2026-10-22 — an intermittent "3 alive" was seen once in three full gates and never
   * standalone): the snapshot above, and a recount after the 100 ms fallback timer and another gc.
   * Gone after the wait is a TIMING survivor (a pending server-side callback); still there is structural. Costs
   * nothing when green. ONE file per mode, overwritten by the next failure (2026-11-11): named by process id, every
   * failing run left 7 MB per mode in the temp directory for good (24 of them, 156 MB, found when the disk filled).
   */
  if (out.alive > 0) {
    await new Promise((r) => setTimeout(r, 250));
    await gc();
    out.objectsAfterWait = queryObjects(Class, { format: 'count' });
    out.aliveAfterWait = refs.filter((r) => r.deref() !== undefined).length;
  }
}
if (mode === 'retainers-control') {
  /**
   * The evidence's CONTROL: of three rendered hosts, one held by a planted global must be found with that holder on its
   * path, and the two dropped must not be found at all.
   */
  for (let i = 0; i < 3; i++) await renderToString(url('comp-define-props.mjs'));
  (() => { globalThis.__plantedHolder = { pending: [globalThis.__refs[1].deref()] }; })();
  await gc();
  const { writeHeapSnapshot } = await import('node:v8');
  const { tmpdir } = await import('node:os');
  const { retainerPaths } = await import('./retainers.mjs');
  const found = retainerPaths(writeHeapSnapshot(`${tmpdir()}/vera-ssr-release-${mode}.heapsnapshot`), { weakRefsIn: '__refs' });
  Object.assign(out, { found: found.length, named: found.some(({ path }) => path.join(' ').includes('property:__plantedHolder')) });
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
  const { flush } = await import('@verajs/core');
  flush(); await new Promise((r) => setTimeout(r, 0)); flush();
  const second = (await renderToStringAsync(url('comp-lazy.mjs'))).html;
  Object.assign(out, { first: first.includes('<i>2</i>'), second: second.includes('<i>42</i>') });
}
await gc();
Object.assign(out, { kept: keptRef.deref() !== undefined, droppedDied: droppedRef.deref() === undefined });
process.stdout.write(JSON.stringify(out));
