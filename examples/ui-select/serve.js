/**
 * Plain static file server, same reasoning as `examples/cdn-js/serve.js`: no transform, no
 * resolution, bytes off disk — the importmap behaves exactly as it would on a CDN. Serves the
 * repo root so `/packages/<pkg>/dist/*.min.js` resolves as written.
 *
 *   node examples/ui-select/serve.js  ->  http://localhost:5177/examples/ui-select/
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = Number(process.env.PORT) || 5177;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
};

createServer(async (request, response) => {
  let path = normalize(new URL(request.url, 'http://x').pathname).replace(/^\/+/, '');
  if (path === '' || path.endsWith('/')) path += 'index.html';
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT)) return response.writeHead(403).end();
  try {
    const body = await readFile(file);
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404).end('not found');
  }
}).listen(PORT, () => console.log(`vera-select viewer: http://localhost:${PORT}/examples/ui-select/`));
