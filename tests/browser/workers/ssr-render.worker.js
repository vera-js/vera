/**
 * Renders through `@verajs/ssr` inside a real Web Worker, for `../ssr-worker.test.js`.
 *
 * **Nothing here works around the four defects the suite exists to hold**, which is the point — each
 * one fails this worker in its own way, and a workaround would quietly restore the green:
 *
 *   - `node:crypto` → the module does not resolve in a browser at all.
 *   - `globalThis.self = …` → throws while the shim installs, so the import rejects.
 *   - `globalThis.postMessage = () => {}` → every reply below vanishes and the test times out
 *     with the worker in perfect health. **So `self.postMessage` is called live rather than
 *     captured up front**; capturing it (which is what a host has to do against a broken shim)
 *     would pass whether or not the shim was fixed.
 *   - the read-only `WorkerLocation` → the `location` option throws, which is the case the CMS's
 *     per-route rendering depends on.
 *
 * A worker has no import map, so the bare specifier below is resolved by the dev server's
 * `nodeResolve` — the same rewrite that lets the rest of the browser suite import workspace
 * packages. The component it renders imports `@verajs/core` the same way, so both reach one core
 * and therefore one inserts registry.
 */
/**
 * **The listener is registered before the import, and the import is dynamic to allow that.**
 * `@verajs/ssr` evaluates through a top-level `await`, and a message that arrives during it is
 * *dropped* rather than queued when no handler is set yet — which cost a round of timeouts that
 * looked exactly like the shim failing to install. A static import would hoist above any statement
 * here and leave the same gap.
 */
const pending = [];
let handle = (data) => pending.push(data);
self.addEventListener('message', ({ data }) => handle(data));

/** Read before the shim replaces `globalThis.location` with its own (seeded from this one). */
const COMPONENT = new URL('/tests/fixtures/ssr/hello-ssr.js', self.location.origin).href;

const { renderToString } = await import('@verajs/ssr');

handle = async (data) => {
  try {
    const result = await renderToString(COMPONENT, data?.options);
    self.postMessage({ ok: true, html: result.html });
  } catch (error) {
    self.postMessage({ ok: false, error: `${error?.name}: ${error?.message}` });
  }
};
for (const data of pending.splice(0)) handle(data);
