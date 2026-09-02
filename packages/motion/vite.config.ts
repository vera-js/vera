import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * `vite` — dev server for the demo page (index.html) and the spike fixtures.
 *
 * There is deliberately no `build` block: the library is built by rollup via
 * wireit (`npm run build`), and the demo by `vite.demo.config.ts`. A lib-mode
 * build lived here from the pre-migration Vite toolchain, emitting a
 * `dist/motion.js` nothing invoked and no export mapped — removed 2026-09-01
 * (Brian's call) once the last fixtures still loading its artifact names were
 * re-pointed at the rollup ones.
 */
export default defineConfig({
  /** The build constant the library folds diagnostics behind; the demo is a development page. */
  define: { __DEV__: 'true' },
  /**
   * Vite's default cache lands in `node_modules/.vite` beside this config, which conjures a
   * package-local `node_modules` out of nothing in a package that has no dependencies. The root
   * `node_modules` is where machine-local cache noise already lives; keep it all there.
   */
  cacheDir: resolve(import.meta.dirname, '../../node_modules/.vite/motion'),

  /**
   * `src/vera.ts` imports the runtime by its published name, so the built
   * artifact references `@verajs/motion` instead of inlining a second copy.
   * Tests and the dev server resolve that back to the source.
   */
  resolve: {
    alias: { '@verajs/motion': resolve(import.meta.dirname, 'src/index.ts') },
    /**
     * The spike fixtures are reached through the gitignored symlink, and without this vite
     * realpaths them to the portal clone — outside its root — where its HTML proxy refuses the
     * inline module scripts every fixture uses. Preserving symlinks keeps them at the path they
     * are served from, which is inside the package.
     */
    preserveSymlinks: true,
  },

  /**
   * The measurement harnesses are reached through a gitignored symlink that resolves above this
   * package (still inside the repository). Allowing the repo root keeps the dev server serving
   * them regardless of how vite's workspace detection resolves.
   */
  server: { fs: { allow: [resolve(import.meta.dirname, '../..')] } },
});
