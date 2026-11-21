import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
/** The paths the fail-once route has already failed (see `middleware`). */
const failedOnce = new Set();

export default {
  /**
   * **The root in its canonical spelling, not the launching shell's.** On Windows the drive letter's case follows how the
   * shell got its cwd (VS Code starts one in `c:\…`, Git Bash's `/c/…` gives `C:\…`), while node-resolve's realpath
   * through a workspace link always answers `C:\…`. The runner compares the two by case, so from a lowercase cwd every
   * module reached through a link failed with "could not be converted to a browser path" (65 Chromium rows red).
   * `realpathSync.native` answers the file system's own spelling, whichever shell launched the run, and the config's own
   * directory, not the cwd, is the checkout, so a run with `--config` from another directory roots here too.
   */
  rootDir: realpathSync.native(fileURLToPath(new URL('.', import.meta.url))),
  files: 'tests/browser/**/*.test.js',
  nodeResolve: true,
  /**
   * A real SSE wire for the stream suite: the runner's own server pushes one JSON patch and one
   * named markup event per connection, then holds until the client closes — a real EventSource
   * against real server bytes, on every engine. (WebSocket stays stub-covered in the node
   * suite: wtr's server exposes no upgrade seam, and the socket half's logic — pump, queue,
   * reconnect — is transport-independent.)
   */
  middleware: [
    async (ctx, next) => {
      if (ctx.path !== '/wtr-sse') return next();
      ctx.respond = false;
      const res = ctx.res;
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      res.write('data: {"streamed": 21}\n\n');
      setTimeout(() => res.write('event: story\ndata: <em id="sse-pushed">pushed</em>\n\n'), 60);
      ctx.req.on('close', () => res.end());
    },
    /**
     * **A module that fails once, then loads**: `…/fixtures/autoloader/once/<token>/<tag>.js` answers 404 the first time
     * that exact path is asked for and a module defining `<tag>` every time after, the dropped connection that comes back
     * which the autoloader's `retry` exists for. The token is the asking row's, so each row on each engine gets its own
     * first failure from this one server.
     */
    async (ctx, next) => {
      const match = /^\/tests\/browser\/fixtures\/autoloader\/once\/[a-z0-9]+\/([a-z][a-z0-9]*-[a-z0-9-]*)\.js$/.exec(ctx.path);
      if (match === null) return next();
      ctx.set('cache-control', 'no-store');
      if (!failedOnce.has(ctx.path)) {
        failedOnce.add(ctx.path);
        ctx.status = 404;
        return;
      }
      ctx.type = 'text/javascript';
      ctx.body = `customElements.define('${match[1]}', class extends HTMLElement {});\n`;
    },
  ],
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
  /**
   * **2026-09-18: the same symptom appeared again and is NOT load, and not concurrency.** Measured,
   * because the two paragraphs above would have sent the next person the wrong way:
   *
   * - it reproduces on an IDLE machine (load average 3, nothing else running);
   * - `VERA_WTR_CONCURRENCY=1` does not help — the count is identical;
   * - killing 22 leaked Playwright processes first does not help;
   * - Playwright launches WebKit and renders a page in 1.4 s, so the browser is healthy;
   * - it reproduces with the working tree's changes REVERTED and rebuilt, so it is not content;
   * - and `413 passed` is now DETERMINISTIC across runs, where a load flake varied (420, 456).
   *
   * What it actually is: WebKit stops being able to open a page after roughly 59 of the 79 files in
   * ONE browser instance. `tests/browser/shadow-modes.test.js` is where it lands, and that file
   * passes in 2.3 s when run alone — so the boundary is cumulative pages opened, not any one file.
   * Chromium and Firefox complete the same run.
   *
   * Left unfixed rather than papered over: raising the timeout again would only wait longer for a
   * browser that has stopped answering. The fix is to make the runner recycle the WebKit instance
   * partway through, or to move past the Playwright version that does this.
   */
  testFramework: {
    config: { timeout: 5000 },
  },
};
