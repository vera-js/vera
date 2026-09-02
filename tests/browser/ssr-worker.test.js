import { expect } from '@esm-bundle/chai';
import { SERVER_HTML } from './fixtures/hello-ssr.html.js';

/**
 * **`@verajs/ssr` rendering inside a browser Web Worker, byte-identical to the server.**
 *
 * The package installs ~35 globals — `document`, `window`, `customElements` among them — so it
 * cannot run on a page's main thread without destroying the host's own DOM. A worker has none of
 * them to destroy, which is why that is the supported browser environment and the one this holds.
 *
 * Nothing here is a browser-flavoured re-render of what the node suites already cover: the
 * comparison is against `SERVER_HTML`, which is **real `@verajs/ssr` output generated in Node** by
 * `scripts/build-hydration-fixture.mjs` from the same component this renders, and which
 * `npm run gate` re-checks. So a pass means the two environments agree byte-for-byte rather than
 * that the browser produced something plausible.
 *
 * Four defects had to be fixed for this to be possible, and this file fails on each of them
 * separately — see `workers/ssr-render.worker.js`, which deliberately works around none of them.
 * `tests/ssr-shim-host-globals.test.mjs` holds the server half; it cannot hold this one, because on
 * Node the fixed and unfixed code are indistinguishable, which is exactly the property that made
 * the fixes safe.
 */

const render = (options) =>
  new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./workers/ssr-render.worker.js', import.meta.url), { type: 'module' });
    const done = (fn) => (value) => {
      worker.terminate();
      fn(value);
    };
    worker.onmessage = ({ data }) =>
      data.ok ? done(resolve)(data.html) : done(reject)(new Error(data.error));
    /**
     * A worker whose module fails to evaluate reports here and nowhere else — without this the
     * suite would report a timeout for `node:crypto` failing to resolve, which names nothing.
     */
    worker.onerror = (event) => done(reject)(new Error(event.message ?? 'the worker failed to start'));
    worker.postMessage({ options });
  });

it('renders in a worker byte-for-byte identically to the server', async () => {
  const html = await render();
  expect(html).to.equal(SERVER_HTML);
});

it('applies the per-render location option, which a worker location is too read-only to take', async () => {
  /**
   * The case the whole thing exists for: a static build renders one page per route, each with its
   * own URL. `applyLocation` mutates `globalThis.location` in place, and a worker's real
   * `WorkerLocation` refuses every write — so before the shim installed its own mutable location
   * this threw `Cannot set property href of [object WorkerLocation]`.
   *
   * The component does not read `location`, so the markup is unchanged; what is under test is that
   * asking for a route is possible at all.
   */
  const html = await render({ location: '/users/2?page=3' });
  expect(html).to.equal(SERVER_HTML);
});

it('leaves the host its channel back to the page', async () => {
  /**
   * Asserted rather than assumed, because losing it is silent: `postMessage` is in the shim's inert
   * window-methods list, and a worker whose `postMessage` has been replaced with a no-op renders
   * perfectly and looks exactly like one that crashed. Every other assertion here depends on this
   * one holding, so it is named — a timeout elsewhere would otherwise be diagnosed as a render bug.
   */
  const html = await render();
  expect(html, 'a reply arrived at all').to.be.a('string');
  expect(html.length).to.be.greaterThan(50);
});
