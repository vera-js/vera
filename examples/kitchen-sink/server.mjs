/**
 * The kitchen sink, served three ways from one application.
 *
 *   node examples/kitchen-sink/server.mjs
 *
 *   http://localhost:3002/         server-rendered, then hydrated in place
 *   http://localhost:3002/csr      the same components, rendered from scratch in the browser
 *   http://localhost:3002/ssr      the server's markup with no client script at all
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
import { render } from '${
  mode === 'hydrate'
    ? '/packages/renderer/dist/development/vera-renderer-hydrate.js'
    : '/packages/renderer/dist/development/vera-renderer.js'
}';
await start(render);
document.documentElement.dataset.sinkMode = '${mode}';
`;

const page = ({ body, styles, script }) => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vera kitchen sink</title>
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

  if (path === '/csr') {
    return response.end(page({ body: '<sink-shell></sink-shell>', styles: '', script: '/client-csr.js' }));
  }

  /**
   * `/` and `/ssr` share one render, because the only difference between them is whether a script
   * tag follows it — which is the point: the markup a reader without JavaScript gets is byte for
   * byte the markup the hydrating client adopts.
   */
  const { html, styles } = await renderToString(ENTRY);
  response.setHeader('content-type', 'text/html');
  return response.end(
    page({ body: html, styles, script: path === '/ssr' ? '' : '/client-hydrate.js' })
  );
}).listen(PORT, () => console.log(`kitchen sink at http://localhost:${PORT} (/ hydrate, /csr, /ssr)`));
