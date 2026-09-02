/**
 * The vera-native SSR server — zero dependencies beyond Node itself: no fastify, no wcc, no lit.
 * `@verajs/ssr` must be imported before anything that imports core (it installs the server
 * environment first, then wires the serializer as the renderer).
 *
 *   node examples/ssr-node/server-native.mjs
 *
 * It serves the whole round trip, not just the markup: the page ships a client module that imports
 * `@verajs/renderer/hydrate` and adopts what the server sent. This example used to stop at the
 * markup, which left the headline claim — swap one import and the server DOM is adopted in place —
 * as something the reader had to take on trust.
 */
import { renderToString } from '@verajs/ssr';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const PORT = 3001;
const component = new URL('./components/hello-ssr.js', import.meta.url);

/**
 * The client half, served as a module.
 *
 * `props` is what carries structured data to a component — an attribute can only hold a string —
 * and the same values are handed to the client so both halves render the same thing. Anything the
 * two disagree on is a hydration mismatch, which is silent: the container is cleared and rendered
 * fresh, so the page looks right and the server work is thrown away.
 */
const CLIENT = `
import { wire } from '/packages/core/dist/development/vera.js';
import { renderer } from '/packages/renderer/dist/development/vera-renderer-hydrate.js';

wire([renderer]);
await import('/examples/ssr-node/components/hello-ssr.js');
document.body.dataset.hydrated = 'true';
`;

const REPO = new URL('../../', import.meta.url);

createServer(async (req, res) => {
  const path = req.url?.split('?')[0] ?? '/';

  /** Serve the client module and anything it imports, straight off disk. */
  if (path === '/client.js') {
    res.setHeader('content-type', 'text/javascript');
    return res.end(CLIENT);
  }
  if (path.endsWith('.js')) {
    try {
      const file = new URL(`.${path}`, REPO);
      /** Inside the repo only — a request path must never reach outside it. */
      if (!file.href.startsWith(REPO.href)) throw new Error('outside');
      res.setHeader('content-type', 'text/javascript');
      return res.end(await readFile(file));
    } catch {
      res.statusCode = 404;
      return res.end('not found');
    }
  }

  /**
   * `base` is unnecessary for a constant path like this one and is passed anyway, because the
   * moment this grows a route-to-component mapping it becomes necessary and nobody will remember.
   */
  const { html, styles } = await renderToString(component, { base: new URL('./components/', import.meta.url) });
  res.setHeader('content-type', 'text/html');
  res.end(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vera-native SSR</title>
    ${styles ? `<style>${styles}</style>` : ''}
  </head>
  <body>
    ${html}
    <script type="module" src="/client.js"></script>
  </body>
</html>`);
}).listen(PORT, () => console.log(`vera-native SSR at http://localhost:${PORT}`));
