/**
 * Entry point for the buildless example.
 *
 * Identical in shape to `examples/npm-ts/src/index.ts`, with two differences that matter:
 *
 *   1. `connectInserts` is load-bearing here, not ceremonial. Each standalone bundle inlines its
 *      own copy of `@verajs/inserts`, so `@verajs/core` and `@verajs/router` arrive carrying two
 *      separate registries. This call points the router at core's. Under a bundler both resolve
 *      to one instance and the call does nothing.
 *
 *   2. The autoloader keeps its default `.js` extension, because these files really are `.js`.
 */
import { setHtml, setRenderer, setAutoloader, inserts, insert } from '@verajs/core';
import { initAutoloader } from '@verajs/autoloader';
import { connectInserts } from '@verajs/router';
import { html, render } from 'lit-html';
import { computedValues } from './inserts/computed.js';

connectInserts(inserts);

/**
 * A worked example of extending Vera through the insert system: computed values as a ten-line
 * `'proxy-handler'` insert (see src/inserts/computed.js). Priority is required — chains are
 * priority-ordered.
 */
insert('proxy-handler', computedValues, 40);


/**
 * Components load lazily by tag name, relative to this file.
 *
 * `setAutoloader` covers everything a component *renders*. The three lines after it cover what a
 * render never touches, and are the whole of the module's other surface:
 */
const autoload = initAutoloader(import.meta.url, 'components');
setAutoloader(autoload);

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

setRenderer(render);
setHtml(html);

/**
 * Dynamic `import()`, not a static one. A static `import` declaration is **hoisted** and evaluates
 * before this module's body, so `demo-app` would `customElements.define()` and upgrade before
 * `setRenderer` / `setHtml` above had run — rendering through core's defaults and painting a literal
 * `[object Object]` where the template should be.
 *
 * Configuration must complete before any component defines itself.
 */
await import('./components/demo-app.js');
