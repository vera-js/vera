/**
 * Entry point for the npm + TypeScript example.
 *
 * Everything here resolves through bare specifiers (`@verajs/core`, `@verajs/renderer`), which is
 * how a real consumer installs VeraJS. In this repo `vite.config.js` aliases `@verajs/*` to the
 * package sources so the example runs against live code rather than a published build.
 *
 * The buildless counterpart of this file is `examples/cdn-js/src/index.js`.
 */
import { wire } from '@verajs/core';
import { autoloader } from '@verajs/autoloader';
import { renderer } from '@verajs/renderer';
import { slots } from '@verajs/renderer/slots';
import { styles } from '@verajs/styles';
import { router } from '@verajs/router';

/**
 * The router imports no registry of its own, so this hands it core's — the same line, and the same
 * meaning, as in the CDN example. It used to be `connectInserts`, which was a no-op here and
 * load-bearing there; that asymmetry is gone.
 */
wire([router]);


/**
 * Components are discovered lazily by tag name. The extension has to be `.ts` in dev because vite
 * serves the TypeScript sources; a dev server will not answer a request for `hello-component.js`
 * when only `hello-component.ts` exists on disk.
 */
const autoload = autoloader(import.meta.url, 'components', {
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

/**
 * The renderer, plus the two modules this app's components actually need: light-DOM slots, because
 * `<parent-element>` renders a `<slot>` without attaching a shadow root, and `static styles`
 * adoption, which left core in 0.2.0. Both were found by reading the development diagnostics rather
 * than by knowing — each names the module and the exact line to add.
 */
wire([renderer, slots, styles]);

/**
 * Loaded with dynamic `import()` on purpose — a static `import` declaration is **hoisted** and runs
 * before this module's body, so the components would `customElements.define()` and upgrade before
 * the `wire` calls above had run. A component that renders before a renderer is wired has nothing
 * on the `'render'` insert to write its output, and core says so rather than painting anything.
 *
 * Configuration must complete before any component defines itself.
 */
await import('./components/main.js');
await import('./components/base.js');

/** TSX component — compiled by @verajs/jsx (see vite.config.js); imported directly since the
 * autoloader here fetches `.ts` files and this one is `.tsx`. */
await import('./components/jsx-demo.tsx');
