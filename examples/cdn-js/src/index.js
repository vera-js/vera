/**
 * Entry point for the buildless example.
 *
 * Identical in shape to `examples/npm-ts/src/index.ts`, with two differences that matter:
 *
 *   1. `connectRouter` reads identically here and under a bundler. The router imports no registry
 *      at all, so there is no second one to reconcile — this hands it core's, in every build. It
 *      replaced `connectInserts`, which was load-bearing in this file and ceremonial in the npm
 *      one, and which nothing but this asymmetry required.
 *
 *   2. The autoloader keeps its default `.js` extension, because these files really are `.js`.
 */
import { setHtml, wire } from '@verajs/core';
import { autoloader } from '@verajs/autoloader';
import { connectRouter } from '@verajs/router';
import { html, render } from 'lit-html';
import { computedValues } from './inserts/computed.js';

/**
 * Everything this app wires, in one call, from data rather than side effects — a **connector** for
 * a package that imports nothing, and a **descriptor** for a handler written right here. Computed
 * values as a ten-line `'proxy-handler'` insert are the worked example (see
 * src/inserts/computed.js); priority is required, because chains are priority-ordered.
 */
wire([connectRouter, { on: 'proxy-handler', fn: computedValues, priority: 40 }]);


/**
 * Components load lazily by tag name, relative to this file.
 *
 * The autoloader covers everything a component *renders*. The three lines after it cover what a
 * render never touches, and are the whole of the module's other surface:
 */
const autoload = autoloader(import.meta.url, 'components');
wire(autoload);

/** Markup written by hand in index.html — nothing renders it, so it has to be asked for. */
autoload();

/**
 * `url(tag)` is the URL the loader would fetch. Warming it is a `modulepreload` link, but with the
 * URL in hand it could as easily be a prefetch or a service-worker cache.
 */
const warm = document.createElement('link');
warm.rel = 'modulepreload';
warm.href = autoload.url('demo-counter');
document.head.appendChild(warm);

/**
 * A failed load is permanent for the page, which is right for a component that does not exist and
 * wrong for one lost to a dropped connection. The event hands over the element to retry.
 */
addEventListener('vera:autoload-error', ({ detail }) => {
  if (navigator.onLine) return;
  addEventListener('online', () => autoload.retry(detail.element), { once: true });
});

wire({ on: 'render', fn: render, priority: 50 });
setHtml(html);

/**
 * Dynamic `import()`, not a static one. A static `import` declaration is **hoisted** and evaluates
 * before this module's body, so `demo-app` would `customElements.define()` and upgrade before
 * `wire(render)` / `setHtml` above had run — rendering through core's defaults and painting a literal
 * `[object Object]` where the template should be.
 *
 * Configuration must complete before any component defines itself.
 */
await import('./components/demo-app.js');
