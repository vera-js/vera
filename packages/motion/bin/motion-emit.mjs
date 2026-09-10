#!/usr/bin/env node
/**
 * `vera-motion-emit` — first-frame correctness for ANY toolchain that ends in HTML files.
 *
 *   npx vera-motion-emit dist/**\/*.html
 *   npx vera-motion-emit index.html about.html
 *
 * Reads each built page, runs the REAL emission pipeline (`renderMotion` — the same parser and
 * generator the client runs, so every identity is re-derived byte-for-byte at hydration), and
 * writes the page back with markers and the motion stylesheet in place. Hugo, Jekyll, exported
 * site builders, hand-written HTML — anything static gets the server-rendered first frame as one
 * post-build command, with zero knowledge of vera beyond the attribute it already wrote.
 *
 * Needs a DOM to host the page: `jsdom` is looked up from YOUR project (a dev dependency there),
 * not shipped inside this package — it is a build-time tool's weight, not a browser bundle's.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const files = process.argv.slice(2).filter((a) => !a.startsWith('-'));
if (!files.length) {
  console.error('usage: vera-motion-emit <built html files…>   (shell globs expand; add jsdom as a devDependency)');
  process.exit(2);
}

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.error('vera-motion-emit needs jsdom in your project: npm i -D jsdom');
  process.exit(2);
}

/**
 * One shared window's globals, installed once — the emitter and the packs read the ambient DOM
 * exactly as they would in a browser. Each FILE still gets its own fresh JSDOM document below;
 * only the constructors are shared.
 */
const host = new JSDOM('<!doctype html>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'CSSStyleSheet', 'MutationObserver', 'getComputedStyle',
  'IntersectionObserver', 'ResizeObserver']) {
  if (host.window[k]) globalThis[k] = host.window[k];
}
globalThis.requestAnimationFrame = host.window.requestAnimationFrame.bind(host.window);
globalThis.cancelAnimationFrame = host.window.cancelAnimationFrame.bind(host.window);

/** Self-referential imports: resolve this very package's own exports, dev or published. */
const { renderMotion } = await import('@verajs/motion/ssr');
const { paintRows, pathRows, sequenceRows, lookUpPreset } = await import('@verajs/motion/internal');

let pages = 0;
let elements = 0;
for (const file of files) {
  const html = readFileSync(file, 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  /** The full shipped wire array — identical resolution to a page that wires everything. */
  const report = renderMotion(dom.window.document, {
    wire: [{ on: 'preset', fn: lookUpPreset }, paintRows, pathRows, sequenceRows],
  });
  for (const problem of report.problems) {
    console.warn(`${file}: ${problem.code}${problem.args.length ? ` (${problem.args.join(', ')})` : ''}`);
  }
  if (report.rendered) {
    writeFileSync(file, dom.serialize());
    pages++;
    elements += report.rendered;
  }
}
console.log(`vera-motion-emit: ${elements} element(s) across ${pages} page(s) now paint frame 0 with no JavaScript.`);
