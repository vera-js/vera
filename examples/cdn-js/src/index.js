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


/** Components load lazily by tag name, relative to this file. */
setAutoloader(initAutoloader(import.meta.url, 'components'));

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
