import { playwrightLauncher } from '@web/test-runner-playwright';

/**
 * Browser-truth test layer.
 *
 * `VIABILITY.md` calls this the binding constraint on trust, and the 2026-08-22 testing audit
 * measured why: jsdom has no `adoptedStyleSheets`, no `CSSStyleSheet.replaceSync`, no
 * `CSSScopeRule`, does not parse declarative shadow DOM, and runs no layout engine. So
 * `@verajs/styles` had never once executed its real code path, and hydration could not be tested
 * end to end. Those are not gaps in the suites — they are gaps in the environment.
 *
 * These suites hold what only a real browser can prove. Everything else stays under `node --test`,
 * which is faster and runs against both build conditions.
 *
 *   npm run test:browser              # chromium
 *   npm run test:browser -- --browsers chromium firefox webkit
 *
 * `nodeResolve` is required: the development bundles import `@verajs/inserts` as a bare specifier
 * (that is the point — the consumer's bundler dedupes it), and a browser cannot resolve that alone.
 */
export default {
  files: 'tests/browser/**/*.test.js',
  nodeResolve: true,
  browsers: [playwrightLauncher({ product: 'chromium' })],
  testFramework: {
    config: { timeout: 5000 },
  },
};
