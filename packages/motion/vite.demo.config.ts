import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Builds the demo page as an application, for comparing a production load
 * against the dev server's on-demand module waterfall.
 *   npm run build:demo && npm run preview:demo
 */
export default defineConfig({
  /** The build constant the library folds diagnostics behind; the demo is a development page. */
  define: { __DEV__: 'true' },
  /** Same cache relocation as vite.config.ts — no package-local node_modules. */
  cacheDir: resolve(import.meta.dirname, '../../node_modules/.vite/motion-demo'),
  build: { outDir: 'dist-demo', emptyOutDir: true, target: 'es2022' },
});
