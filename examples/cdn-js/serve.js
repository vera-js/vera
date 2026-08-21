/**
 * Plain static file server for the buildless example.
 *
 * This exists deliberately instead of reusing vite. Vite resolves bare specifiers itself via
 * `resolve.alias`, so it would rewrite `@verajs/core` to the package *source* and ignore the
 * importmap — the example would appear to exercise the built bundles while actually exercising
 * TypeScript sources through a transform pipeline. That is precisely the claim this example is
 * supposed to prove false-proof.
 *
 * So: no transform, no resolution, no bundler. Bytes off disk, exactly what a browser would get
 * from a CDN. If it works here, it works on CodePen.
 *
 * Serves the repo root so `/packages/<pkg>/dist/*.min.js` resolves as written in the importmap.
 *
 *   node examples/cdn-js/serve.js  ->  http://localhost:5174/examples/cdn-js/
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = Number(process.env.PORT) || 5174;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  const url = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);

  /** Resolve inside ROOT and confirm containment before touching the filesystem. */
  const target = normalize(join(ROOT, url.endsWith('/') ? `${url}index.html` : url));
  if (!target.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(target)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Not found: ${url}\n\nIf this is a bundle, run \`npm run build\` first.`);
  }
}).listen(PORT, () => {
  console.log(`buildless example: http://localhost:${PORT}/examples/cdn-js/`);
});
