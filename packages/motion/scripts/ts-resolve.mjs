/**
 * Lets `node --experimental-strip-types` follow this codebase's `.js`
 * specifiers to the `.ts` files they mean.
 *
 * Source imports are written `./schema.js` — the compiled spelling, which is
 * what TypeScript's bundler resolution and every bundler expect. Node's type
 * stripping does not rewrite them, so the moment `schema.ts` gained its first
 * relative import the reference generator stopped being able to load it.
 *
 * Registered via `--import`, so the hook is in place before the script runs.
 * No dependency: this exists instead of adding a TypeScript runner for one
 * docs script.
 */
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && specifier.endsWith('.js')) {
      try {
        const asTs = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
        if (existsSync(fileURLToPath(asTs))) {
          return { url: asTs.href, shortCircuit: true };
        }
      } catch {
        /* fall through to the default resolver */
      }
    }
    return next(specifier, context);
  },
});

/**
 * The build folds `__DEV__` to a literal; scripts run the source unbuilt, so
 * the global must exist before any module references it. `true`: the docs
 * scripts quote diagnostics, and the full sentences are the development ones.
 */
globalThis.__DEV__ = true;
