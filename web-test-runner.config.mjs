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
    .map((product) =>
      playwrightLauncher({
        product,
        /**
         * Chromium only, and only useful to the memory suites: `window.gc` lets a test prove a node
         * is collectable rather than assume it. jsdom cannot answer this — it reports an observed
         * node as retained even after `disconnect()`, which is its own bookkeeping. Ignored by the
         * other engines, whose suites skip those checks.
         */
        launchOptions: product === 'chromium' ? { args: ['--js-flags=--expose-gc'] } : undefined,
        /**
         * The second half of the load-tolerance pair with `browserStartTimeout` below: raising
         * that knob alone moved the same WebKit failure one step later, into Playwright's OWN 30s
         * default on the session's first `page.goto`. Both waits are infrastructure — nothing in
         * them is content — so both get the same generous ceiling, and the per-TEST timeout stays
         * tight.
         */
        createPage: async ({ context }) => {
          const page = await context.newPage();
          page.setDefaultNavigationTimeout(120000);
          return page;
        },
      })
    ),
  /**
   * WebKit under FULL-GATE load fails to CREATE a test page inside the default 30s — three
   * startup timeouts per run, with every test that did run green on all three engines (recorded
   * as the known infra flake before this was raised). A startup timeout is pure machine-load
   * tolerance: nothing it waits on is content, so waiting longer cannot mask a failure the way a
   * lengthened TEST timeout could — which stays at 5s for exactly that reason.
   */
  browserStartTimeout: 120000,
  /**
   * The other half of the same load story: with three engines x cores/2 files in flight, WebKit
   * intermittently fails to CREATE a page at all — with every test that did run green (456/0 at
   * the last occurrence), so the failure is the harness's own concurrency, not content. Halving
   * in-flight files keeps WebKit reliably able to open pages; the wall-clock cost on the full
   * suite measured under a second per engine.
   */
  concurrency: Number(process.env.VERA_WTR_CONCURRENCY ?? 3),
  testFramework: {
    config: { timeout: 5000 },
  },
};
