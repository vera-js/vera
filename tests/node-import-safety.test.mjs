/**
 * Which entry points can be imported where there is no DOM.
 *
 * SSR is a first-class consumption mode, so a shared module that both halves of an app import is an
 * ordinary thing to write — and `@verajs/renderer` captures `document` at module scope, so importing
 * it on a server throws `ReferenceError: document is not defined` before a line of app code runs.
 *
 * That behaviour is defensible: a DOM renderer needs a DOM, and there is nothing useful it could do
 * server-side. What was not defensible was the silence. `@verajs/router` documents this property
 * *for itself*, in both its README and `llms.txt` — "importing the router is side-effect-free… so
 * `import '@verajs/router'` is safe in Node" — and nothing said the renderer is the other way, which
 * invites exactly the wrong inference.
 *
 * So the answer is written down, and this is what keeps it true. **Each side of the table is
 * load-bearing**: a package moving from safe to throwing breaks a consumer's server, and one moving
 * from throwing to safe means the docs now understate what works.
 *
 * Child processes with no globals installed, because this file's siblings set up jsdom and a package
 * that reads `document` at import time would find one.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { isProduction } from './dist.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const condition = isProduction ? 'production' : 'development';

/** Imports one specifier in a bare Node process and answers what happened. */
const importInNode = (specifier) => {
  try {
    execFileSync(
      process.execPath,
      ['--conditions', condition, '--input-type=module', '-e', `await import(${JSON.stringify(specifier)});`],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    return null;
  } catch (error) {
    const text = String(error.stderr ?? error.message);
    return text.split('\n').find((line) => /Error/.test(line))?.trim() ?? text.slice(0, 120);
  }
};

/**
 * Node-safe: importing does not touch the DOM. `@verajs/ssr` is here by necessity, and
 * `@verajs/jsx` because it is a build-time transform — but `keyed`, `spread`, `slots` and `tag` are
 * here too, which is not obvious from the fact that their parent entry is not.
 *
 * `slots` is the one that has to stay this way for a reason beyond tidiness: `@verajs/ssr` renders
 * light-DOM slots by reaching the module through the insert registry, in Node, with no DOM. It
 * imports nothing and derives every document from the nodes it is handed, which is what keeps it
 * importable there — and this list is what keeps that true.
 */
const SAFE = [
  '@verajs/core',
  '@verajs/inserts',
  '@verajs/reactivity',
  '@verajs/reactivity/collections',
  '@verajs/renderer/keyed',
  '@verajs/renderer/slots',
  '@verajs/renderer/spread',
  '@verajs/renderer/tag',
  '@verajs/router',
  '@verajs/styles',
  '@verajs/autoloader',
  '@verajs/jsx',
  '@verajs/ssr',
];

/**
 * Needs a DOM at import time. The renderer captures `document` and builds two `TreeWalker`s at
 * module scope — deliberately, since sharing them saves an allocation per instance — and the three
 * entries that contain a renderer inherit it.
 */
const NEEDS_A_DOM = [
  '@verajs/renderer',
  '@verajs/renderer/hydrate',
  '@verajs/renderer/profiler',
  '@verajs/jsx/standalone',
];

test('every Node-safe entry point imports where there is no DOM', () => {
  const broken = SAFE.map((specifier) => [specifier, importInNode(specifier)]).filter(([, error]) => error);
  assert.deepEqual(
    broken.map(([specifier, error]) => `${specifier}: ${error}`),
    [],
    'an entry point documented as Node-safe now throws on import'
  );
});

test('the entries that need a DOM still say so, rather than failing later', () => {
  const quiet = NEEDS_A_DOM.filter((specifier) => importInNode(specifier) === null);
  assert.deepEqual(
    quiet,
    [],
    'an entry point that needed a DOM now imports cleanly — the docs understate what works, and the table above should move'
  );
  /** And the failure names the missing global rather than something internal. */
  for (const specifier of NEEDS_A_DOM)
    assert.match(
      importInNode(specifier),
      /document is not defined/,
      `${specifier} fails for a reason other than the missing DOM`
    );
});
