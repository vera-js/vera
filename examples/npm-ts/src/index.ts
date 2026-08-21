/**
 * Entry point for the npm + TypeScript example.
 *
 * Everything here resolves through bare specifiers (`@verajs/core`, `lit-html`), which is how a
 * real consumer installs VeraJS. In this repo `vite.config.js` aliases `@verajs/*` to the package
 * sources so the example runs against live code rather than a published build.
 *
 * The buildless counterpart of this file is `examples/cdn-js/src/index.js`.
 */
import { setHtml, setRenderer, setAutoloader, inserts, insert } from '@verajs/core';
import { initAutoloader } from '@verajs/autoloader';
import { connectInserts } from '@verajs/router';
import { html, render } from 'lit-html';

/**
 * The router ships as an independent module, so under a bundler it shares this one `inserts`
 * registry with core. Calling `connectInserts` is a no-op here and is kept to mirror the CDN
 * example, where the two modules genuinely do carry separate registries.
 */
connectInserts(inserts);


/**
 * Components are discovered lazily by tag name. The extension has to be `.ts` in dev because vite
 * serves the TypeScript sources; a dev server will not answer a request for `hello-component.js`
 * when only `hello-component.ts` exists on disk.
 */
setAutoloader(
  initAutoloader(import.meta.url, 'components', {
    extension: import.meta.env.DEV ? '.ts' : '.js',
  })
);

setRenderer(render);
setHtml(html);

/**
 * Loaded with dynamic `import()` on purpose — a static `import` declaration is **hoisted** and runs
 * before this module's body, so the components would `customElements.define()` and upgrade before
 * `setRenderer` / `setHtml` above had run. They would then render through core's defaults, and a lit
 * template object would reach `template.innerHTML`, painting a literal `[object Object]`.
 *
 * Configuration must complete before any component defines itself.
 */
await import('./components/main.js');
await import('./components/base.js');

/** TSX component — compiled by @verajs/jsx (see vite.config.js); imported directly since the
 * autoloader here fetches `.ts` files and this one is `.tsx`. */
await import('./components/jsx-demo.tsx');
