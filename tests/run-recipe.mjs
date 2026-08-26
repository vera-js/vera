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

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['document', 'HTMLElement', 'Node', 'Element', 'customElements', 'requestAnimationFrame',
                   'cancelAnimationFrame', 'Event', 'CustomEvent', 'CSSStyleSheet', 'DocumentFragment',
                   'Text', 'Comment'])
  globalThis[key] = dom.window[key];

const noise = [];
console.warn = (...args) => noise.push(`warn: ${args.join(' ')}`);
console.error = (...args) => noise.push(`error: ${args.join(' ')}`);
/** Recipes are allowed to log; only warnings and errors are failures. */
console.log = () => {};

const source = Buffer.from(process.argv[2], 'base64').toString('utf8');
await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

/** The scheduler is rAF; one turn past it is enough for a first render and its effects. */
await new Promise((resolve) => setTimeout(resolve, 80));

process.stdout.write(JSON.stringify(noise));
