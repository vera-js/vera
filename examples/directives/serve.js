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
const PORT = Number(process.env.PORT) || 5178;

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
    /**
     * **A routed path is not a file, and a static server has to know that.**
     *
     * `/examples/directives/events` is a route the client owns — there is no such file, so a
     * RELOAD (or a shared link, or the back button after a hard navigation) got a 404 while the
     * same URL reached by clicking worked perfectly. That is not a router bug; it is the one
     * server-side obligation a history-API router places on whatever serves it, and an example
     * that models the client half while getting the server half wrong teaches the wrong lesson to
     * the person who deploys one.
     *
     * So: anything under the example's base that is not a file falls back to its `index.html`, and
     * the client router resolves the path from there. Scoped to the base rather than global,
     * because a missing BUNDLE must still 404 loudly — serving HTML in place of a missing
     * `.min.js` is how "run npm run build first" turns into an unreadable syntax error.
     */
    const base = '/examples/directives/';
    if (url.startsWith(base) && !extname(url)) {
      try {
        const shell = await readFile(join(ROOT, base, 'index.html'));
        res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
        res.end(shell);
        return;
      } catch {
        /** No shell either — fall through to the honest 404 below. */
      }
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Not found: ${url}\n\nIf this is a bundle, run \`npm run build\` first.`);
  }
}).listen(PORT, () => {
  console.log(`directives showcase: http://localhost:${PORT}/examples/directives/`);
});
