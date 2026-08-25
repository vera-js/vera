/**
 * @verajs/jsx/standalone — JSX in the browser, no build step. The Babel-standalone pattern:
 * `<script type="text/vera-jsx">` blocks (inline or src) are transformed at runtime by the same
 * zero-dependency transformer the Vite plugin uses (a few KB — no TypeScript compiler, no Babel),
 * then executed as ES modules. Bare imports inside them — including the auto-injected
 * `html`/`keyed` — resolve through the page's import map.
 *
 * Playground path: great for CodePen, demos and teaching. Production still prefers the Vite
 * plugin, where the same source compiles ahead of time and ships zero transform code. Note:
 * standalone runs JS+JSX; TSX type syntax needs the build path (nothing strips types here).
 *
 *   <script type="importmap"> { "imports": {
 *     "@verajs/core":     ".../vera.min.js",
 *     "@verajs/renderer": ".../vera-renderer.min.js"
 *   } } </script>
 *   <script type="module" src=".../standalone.js"></script>
 *   <script type="text/vera-jsx">
 *     import { init, createStore, render, wire } from '@verajs/core';
 *     ... React-style components ...
 *   </script>
 */
import { transformJsx } from './transform.js';

let counter = 0;

const runBlock = async (script) => {
  const name = script.src || `inline-${counter++}.tsx`;
  const source = script.src ? await (await fetch(script.src)).text() : script.textContent;
  try {
    const js = transformJsx(source, name);
    await import(URL.createObjectURL(new Blob([js], { type: 'text/javascript' })));
  } catch (error) {
    console.error(`[vera-jsx] ${name}:`, error);
  }
};

const boot = async () => {
  /** Sequential, so blocks execute in document order like ordinary scripts. */
  for (const script of document.querySelectorAll('script[type="text/vera-jsx"]')) {
    await runBlock(script);
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

export { transformJsx, runBlock };
