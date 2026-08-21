/**
 * The vera-native SSR server — zero dependencies beyond Node itself: no fastify, no wcc, no lit.
 * `@verajs/ssr/vera` must be imported before anything that imports core (it installs the server
 * environment first, then wires the serializer as the renderer).
 *
 *   node examples/ssr-node/server-native.mjs
 */
import { renderToString } from '@verajs/ssr/vera';
import { createServer } from 'node:http';

const PORT = 3001;

createServer(async (req, res) => {
  const { html, styles } = await renderToString(new URL('./components/hello-ssr.js', import.meta.url));
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
  </body>
</html>`);
}).listen(PORT, () => console.log(`vera-native SSR at http://localhost:${PORT}`));
