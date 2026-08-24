/**
 * The documented example, actually run.
 *
 * `packages/ssr/README.md` points at `examples/ssr-node/server-native.mjs` as the complete round
 * trip, and CLAUDE.md's rule is that documented code is executed rather than merely written. The
 * recipe harness cannot reach this one: `@verajs/ssr` ships source with no `dist` to rewrite to, it
 * has to be imported before anything that imports core, and it needs a component file on disk. So
 * the example is booted as a subprocess and asked for the page, which is what a reader following the
 * README does.
 *
 * What this catches that the unit suites do not: the example drifting away from the package — a
 * renamed option, a moved artifact path in the client module it serves, a changed entry point. Each
 * of those leaves every other test green and the documentation broken.
 */
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const server = spawn(process.execPath, [new URL('../examples/ssr-node/server-native.mjs', import.meta.url).pathname], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
server.stdout.on('data', (chunk) => (output += chunk));
server.stderr.on('data', (chunk) => (output += chunk));

/** Polled rather than slept on: a fixed wait is the flakiest thing a test can do. */
const reach = async (url) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      return await fetch(url);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`the example server never came up:\n${output}`);
};

try {
  const page = await (await reach('http://localhost:3001/')).text();

  assert.match(page, /<hello-ssr>/, 'the component is not in the page');
  assert.match(page, /<template shadowrootmode="open">/, 'the shadow root is not declarative');
  assert.match(page, /hello from the server/, 'the component rendered no content');
  /** The claim the example exists to demonstrate: the client half is served and hydrates. */
  assert.match(page, /<script type="module" src="\/client.js">/, 'the client module is not linked');

  const client = await (await reach('http://localhost:3001/client.js')).text();
  assert.equal((await reach('http://localhost:3001/client.js')).status, 200);
  assert.match(client, /hydrate/, 'the client module does not import the hydrating renderer');

  /** Every path the client module imports must actually be served, or hydration dies in the browser. */
  for (const [, path] of client.matchAll(/from '(\/[^']+)'/g)) {
    const response = await reach(`http://localhost:3001${path}`);
    assert.equal(response.status, 200, `the client imports ${path}, which the server does not serve`);
  }

  console.log('ssr example server ok — page, declarative shadow DOM, client module and its imports');
} finally {
  server.kill();
}
