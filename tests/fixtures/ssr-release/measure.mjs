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
if (mode === 'sync' || mode === 'overlap' || mode === 'async-hook') {
  let markup = '';
  if (mode === 'sync') for (let i = 0; i < N; i++) { markup = (await renderToString(url('comp.mjs'))).html; if (i % 50 === 49) await new Promise((r) => setImmediate(r)); }
  else {
    const page = mode === 'overlap' ? 'comp.mjs' : 'comp-async.mjs';
    const all = await Promise.all(Array.from({ length: N }, () => renderToStringAsync(url(page))));
    markup = all[N - 1].html;
  }
  await gc();
  const refs = globalThis.__refs ?? [];
  Object.assign(out, { rendered: refs.length, markup: markup.includes('<b>0</b>'), alive: refs.filter((r) => r.deref() !== undefined).length });
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
