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
 *   npm run test:browser:all          # chromium, firefox, webkit
 *   VERA_BROWSERS=webkit npm run test:browser
 *
 * Selected by environment variable rather than a CLI flag, matching `VERA_DIST`. `--browsers` is
 * not usable here: `@web/test-runner` rejects it whenever the config defines launchers itself, so
 * the invocation this comment used to suggest could never have worked.
 *
 * `nodeResolve` is required: the development bundles import `@verajs/inserts` as a bare specifier
 * (that is the point — the consumer's bundler dedupes it), and a browser cannot resolve that alone.
 */
export default {
  files: 'tests/browser/**/*.test.js',
  nodeResolve: true,
  /**
   * WebKit is the one that matters most and the one nothing else would catch: `@scope` and
   * `adoptedStyleSheets` have their shakiest support there, and both are load-bearing for
   * `@verajs/styles`. Firefox covers a second engine's custom-element and focus semantics.
   *
   * CI installs chromium only by default; `VERA_BROWSERS` selects more.
   */
  browsers: (process.env.VERA_BROWSERS ?? 'chromium')
    .split(',')
    .map((product) => product.trim())
    .filter(Boolean)
    .map((product) => playwrightLauncher({ product })),
  testFramework: {
    config: { timeout: 5000 },
  },
};
