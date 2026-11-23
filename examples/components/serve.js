/**
 * Plain static file server, same reasoning as `examples/cdn-js/serve.js`: no transform, no resolution, bytes off disk,
 * so the import map behaves exactly as it would on a CDN. Serves the repo root so `/packages/<pkg>/dist/*.min.js`
 * resolves as written. The page itself is generated and committed (`scripts/build-components-page.mjs`).
 *
 *   node examples/components/serve.js  ->  http://localhost:5178/examples/components/
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = Number(process.env.PORT) || 5178;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

createServer(async (request, response) => {
  let path = normalize(new URL(request.url, 'http://x').pathname).replace(/^[/\\]+/, '');
  if (path === '' || path.endsWith('/') || path.endsWith('\\')) path += 'index.html';
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT)) return response.writeHead(403).end();
  try {
    const body = await readFile(file);
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404).end('not found');
  }
}).listen(PORT, () => console.log(`vera components: http://localhost:${PORT}/examples/components/`));
