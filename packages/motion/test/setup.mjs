/**
 * Preload for `node --test` — registered via `--import`, which the test runner
 * propagates to every per-file child process, so each suite gets a fresh DOM
 * and the same resolver.
 *
 * Two module hooks, then the DOM:
 *
 * 1. **`@verajs/motion` resolves to `src/index.ts`.** Source modules import the
 *    rejections registry by the published name (`src/modules/split.ts` imports
 *    `reject` from '@verajs/motion'), and in the workspace that specifier
 *    otherwise resolves through the package's own `exports` map — to `dist/`.
 *    A test importing `../src/split.ts` would then hold TWO copies of the
 *    runtime: refusals written into the dist copy's registry, assertions read
 *    from the src copy's. Same two-registry hazard `check-wiring.js` exists
 *    for, from the other side. The Vite build aliased this identically.
 *
 * 2. **`./x.js` resolves to `x.ts`** — the compiled spelling the source uses,
 *    which Node's type stripping does not rewrite. Same hook as
 *    `scripts/ts-resolve.mjs`, inlined so the test preload is one file.
 *
 * 3. **happy-dom registers its globals** (`document`, `window`, observers,
 *    `CSS.supports`…). happy-dom rather than jsdom, deliberately: the suite
 *    was written against happy-dom's answers, and several of them are
 *    load-bearing — `CSS.supports` answers true broadly (7 files lean on it),
 *    geometry is all-zero so every reading is hand-stubbed. Swapping the DOM
 *    implementation is a semantic change to the suite and is not this port.
 */
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The build folds `__DEV__` to a literal; here the source runs unbuilt, so the
 * global must exist before any module references it. `true` — this suite IS
 * the development run, and the sentences it asserts on only exist there.
 */
globalThis.__DEV__ = true;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@verajs/motion') {
      return { url: pathToFileURL(resolve(root, 'src/index.ts')).href, shortCircuit: true };
    }
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

/** The URL the Vitest happy-dom environment used, so location-reading code sees the same page. */
GlobalRegistrator.register({ url: 'http://localhost:3000/' });

/**
 * The registrator exposes several globals (`CSS`, `history`, …) as getter-only
 * accessors; the Vitest happy-dom environment the suite was written against
 * copied them as plain writable values, and tests assign to them directly
 * (`globalThis.CSS = {}` in degraded-environments). Normalize to the shape the
 * suite knows: same objects, value properties.
 */
for (const name of Object.getOwnPropertyNames(globalThis)) {
  const d = Object.getOwnPropertyDescriptor(globalThis, name);
  if (!d?.get || !d.configurable) continue;
  try {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      enumerable: d.enumerable,
      value: globalThis[name],
    });
  } catch {
    /* a getter that throws stays a getter */
  }
}
