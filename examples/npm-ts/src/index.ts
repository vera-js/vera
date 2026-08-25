/**
 * Entry point for the npm + TypeScript example.
 *
 * Everything here resolves through bare specifiers (`@verajs/core`, `lit-html`), which is how a
 * real consumer installs VeraJS. In this repo `vite.config.js` aliases `@verajs/*` to the package
 * sources so the example runs against live code rather than a published build.
 *
 * The buildless counterpart of this file is `examples/cdn-js/src/index.js`.
 */
import { setHtml, wire } from '@verajs/core';
import { initAutoloader } from '@verajs/autoloader';
import { connectRouter } from '@verajs/router';
import { html, render } from 'lit-html';

/**
 * The router imports no registry of its own, so this hands it core's — the same line, and the same
 * meaning, as in the CDN example. It used to be `connectInserts`, which was a no-op here and
 * load-bearing there; that asymmetry is gone.
 */
wire([connectRouter]);


/**
 * Components are discovered lazily by tag name. The extension has to be `.ts` in dev because vite
 * serves the TypeScript sources; a dev server will not answer a request for `hello-component.js`
 * when only `hello-component.ts` exists on disk.
 */
const autoload = initAutoloader(import.meta.url, 'components', {
  extension: import.meta.env.DEV ? '.ts' : '.js',
});

/** Covers every component that renders. */
wire(autoload);

/** And this covers what no render touches — the marked host written by hand in index.html. */
autoload();

/**
 * A failed load is permanent for the page, which is right for a component that does not exist and
 * wrong for one lost to a dropped connection. The event hands over the element to retry.
 */
addEventListener('vera:autoload-error', (event) => {
  const { element } = (event as CustomEvent<{ element: Element }>).detail;
  if (navigator.onLine) return;
  addEventListener('online', () => autoload.retry(element), { once: true });
});

wire({ on: 'render', fn: render, priority: 50 });
setHtml(html);

/**
 * Loaded with dynamic `import()` on purpose — a static `import` declaration is **hoisted** and runs
 * before this module's body, so the components would `customElements.define()` and upgrade before
 * `wire(render)` / `setHtml` above had run. They would then render through core's defaults, and a lit
 * template object would reach `template.innerHTML`, painting a literal `[object Object]`.
 *
 * Configuration must complete before any component defines itself.
 */
await import('./components/main.js');
await import('./components/base.js');

/** TSX component — compiled by @verajs/jsx (see vite.config.js); imported directly since the
 * autoloader here fetches `.ts` files and this one is `.tsx`. */
await import('./components/jsx-demo.tsx');
