/**
 * The kitchen sink, served three ways from one application.
 *
 *   node examples/kitchen-sink/server.mjs
 *
 *   http://localhost:3002/         server-rendered, then hydrated in place
 *   http://localhost:3002/csr      the same components, rendered from scratch in the browser
 *   http://localhost:3002/ssr      the server's markup with no client script at all
 *   http://localhost:3002/buildless  the minified bundles, resolved by an import map, no build
 *   http://localhost:3002/jsx       JSX transformed in the browser, no toolchain at all
 *
 * Three modes rather than two because they answer different questions. `/ssr` is what a reader with
 * no JavaScript sees and what a crawler indexes. `/csr` is the same application with the server
 * removed. `/` is the handoff — and the one that can be wrong while both others look perfect, since
 * a hydration mismatch is silent by design: the container is cleared and re-rendered, so the page
 * looks right and the server work is thrown away.
 *
 * Zero dependencies beyond Node, matching `examples/ssr-node/server-native.mjs`.
 */
import { renderToString } from '@verajs/ssr/vera';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const PORT = Number(process.env.PORT ?? 3002);
const REPO = new URL('../../', import.meta.url);
const ENTRY = new URL('./entry-ssr.js', import.meta.url);

/**
 * The client half. `mode` picks the renderer entry and nothing else — swapping one import is the
 * documented way to hydrate, so the example has to prove it by doing exactly that.
 */
const client = (mode) => `
import { start } from '/examples/kitchen-sink/entry-client.js';
/** Bare, so the import map decides which renderer this is — one line, one mode. */
import { render } from '@verajs/renderer';
await start(render);
document.documentElement.dataset.sinkMode = '${mode}';
`;

/**
 * The import map, without which **nothing on this page works**.
 *
 * Every component imports bare specifiers — `@verajs/core`, `@verajs/renderer`, `@verajs/styles`,
 * `@verajs/autoloader` — because that is how a component is written in every consumption mode. A
 * browser has no resolver for them: with no map the entire client module graph fails to load, the
 * server's markup sits there looking perfect, and nothing is interactive. Not the buttons, not the
 * router, not one line of it. The quietest possible failure, and the page cannot report it because
 * the code that would have reported it never ran.
 *
 * `@verajs/renderer` points at whichever entry the mode uses, which is the "swap one import" claim
 * made literal: a hydrating app changes this one line.
 */
const importmap = (renderer) =>
  JSON.stringify(
    {
      imports: {
        '@verajs/core': '/packages/core/dist/development/vera.js',
        '@verajs/renderer': `/packages/renderer/dist/development/${renderer}`,
        '@verajs/renderer/spread': '/packages/renderer/dist/development/vera-renderer-spread.js',
        '@verajs/router': '/packages/router/dist/development/vera-router.js',
        '@verajs/autoloader': '/packages/autoloader/dist/development/vera-autoloader.js',
        '@verajs/styles': '/packages/styles/dist/development/vera-styles.js',
        '@verajs/inserts': '/packages/inserts/dist/development/vera-inserts.js',
      },
    },
    null,
    2
  );

const page = ({ body, styles, script, renderer }) => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vera kitchen sink</title>
    ${renderer ? `<script type="importmap">${importmap(renderer)}</script>` : ''}
    ${styles ? `<style>${styles}</style>` : ''}
  </head>
  <body>
    ${body}
    ${script ? `<script type="module" src="${script}"></script>` : ''}
  </body>
</html>
`;

const TYPES = { js: 'text/javascript', mjs: 'text/javascript', html: 'text/html', css: 'text/css', json: 'application/json' };

createServer(async (request, response) => {
  const path = request.url?.split('?')[0] ?? '/';

  if (path === '/client-hydrate.js' || path === '/client-csr.js') {
    response.setHeader('content-type', 'text/javascript');
    return response.end(client(path === '/client-hydrate.js' ? 'hydrate' : 'csr'));
  }

  /** Anything under the repo, so the client module's own imports resolve straight off disk. */
  if (path.startsWith('/packages/') || path.startsWith('/examples/')) {
    try {
      const file = new URL(`.${path}`, REPO);
      response.setHeader('content-type', TYPES[path.split('.').pop()] ?? 'text/plain');
      return response.end(await readFile(file));
    } catch {
      response.statusCode = 404;
      return response.end('not found');
    }
  }

  /**
   * The buildless mode: the **production** bundles resolved by an import map, no toolchain at all.
   * Served from the committed fixture so the page a reader opens is the page the suite tests.
   */
  /** The buildless **JSX** mode: the same transform the Vite plugin uses, running in the browser. */
  if (path === '/jsx') {
    response.setHeader('content-type', 'text/html');
    return response.end(
      await readFile(new URL('../../tests/browser/fixtures/kitchen-jsx-buildless.html', import.meta.url))
    );
  }

  if (path === '/buildless') {
    response.setHeader('content-type', 'text/html');
    return response.end(await readFile(new URL('../../tests/browser/fixtures/kitchen-buildless.html', import.meta.url)));
  }

  if (path === '/csr') {
    return response.end(
      page({
        body: '<sink-shell></sink-shell>',
        styles: '',
        script: '/client-csr.js',
        renderer: 'vera-renderer.js',
      })
    );
  }

  /**
   * `/` and `/ssr` share one render, because the only difference between them is whether a script
   * tag follows it — which is the point: the markup a reader without JavaScript gets is byte for
   * byte the markup the hydrating client adopts.
   */
  const { html, styles } = await renderToString(ENTRY);
  response.setHeader('content-type', 'text/html');
  const wantsScript = path !== '/ssr';
  return response.end(
    page({
      body: html,
      styles,
      script: wantsScript ? '/client-hydrate.js' : '',
      /** `/ssr` ships no script, so it needs no map — that is the whole point of the mode. */
      renderer: wantsScript ? 'vera-renderer-hydrate.js' : '',
    })
  );
}).listen(PORT, () => console.log(`kitchen sink at http://localhost:${PORT} (/ hydrate, /csr, /ssr, /buildless, /jsx)`));
