/**
 * Execute one documented recipe in a process of its own, and report anything it said.
 *
 *   node tests/run-recipe.mjs <base64 module source>
 *
 * A separate process rather than a fresh `import()` with a cache-busting query, because a query
 * only gives a new copy of the module it names. Under the `development` condition workspace
 * dependencies stay **external**, so every copy of `@verajs/core` — however many query strings it
 * is imported under — resolves the same `@verajs/inserts`, and the insert registry is therefore
 * shared across the whole process. Before this runner existed, a recipe that forgot to wire a renderer
 * rendered perfectly well
 * on a renderer some earlier recipe had registered, and the suite proved nothing. Verified: with
 * this runner, deleting the `wire` call from a recipe fails the run.
 *
 * Prints the captured `console.warn`/`console.error` output as JSON on stdout. A thrown error exits
 * non-zero with the stack on stderr.
 */
import { JSDOM } from 'jsdom';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', {
  pretendToBeVisual: true,
  url: 'http://localhost/',
});

/**
 * **The list is what decides which packages *can* have a recipe at all.**
 *
 * It held thirteen names and not `window`, so any `@verajs/router` code died with
 * `ReferenceError: window is not defined` before doing anything — the router resolves a path
 * against `window.location`. That is a barrier rather than a failure: nobody marks a recipe in a
 * package where marking one cannot work, so the gap keeps itself.
 *
 * **None of the names added here is required by a currently marked recipe** — measured by removing
 * each in turn, which changes nothing. They are here so that a recipe touching the window, history
 * or a `MutationObserver` can be written at all; the fix that made a previously impossible recipe
 * pass was the file URL below, not this list.
 */
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Element', 'customElements',
                   'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent',
                   'CSSStyleSheet', 'DocumentFragment', 'Text', 'Comment', 'MouseEvent',
                   'MutationObserver', 'PopStateEvent', 'NodeFilter', 'ShadowRoot', 'location',
                   'history', 'getComputedStyle'])
  globalThis[key] = dom.window[key];
/** jsdom has no layout, and the router scrolls on navigation. */
dom.window.scrollTo = () => {};
globalThis.scrollTo = () => {};

const noise = [];
console.warn = (...args) => noise.push(`warn: ${args.join(' ')}`);
console.error = (...args) => noise.push(`error: ${args.join(' ')}`);
/** Recipes are allowed to log; only warnings and errors are failures. */
console.log = () => {};

const source = Buffer.from(process.argv[2], 'base64').toString('utf8');

/**
 * Written to a file rather than imported as a `data:` URL, because a recipe may read
 * `import.meta.url` — `@verajs/autoloader`'s does, and it is the documented way to use it. Under a
 * data URL that resolves to the base64 blob itself, and the autoloader correctly refuses it with
 * "rootDir must be an absolute URL". A real file URL is also closer to how the code will actually
 * run for a reader.
 */
const file = join(mkdtempSync(join(tmpdir(), 'vera-recipe-')), 'recipe.mjs');
writeFileSync(file, source);
await import(pathToFileURL(file).href);

/** The scheduler is rAF; one turn past it is enough for a first render and its effects. */
await new Promise((resolve) => setTimeout(resolve, 80));

process.stdout.write(JSON.stringify(noise));
