import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import { dts } from 'rollup-plugin-dts';
import { existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

/**
 * @param manglePropsRegex Opt-in property mangling for the production build. Terser mangles locals
 * and top-level names by default, but NOT property names — so internal class fields survive into
 * the bundle unless a package opts in. A package that does prefixes its internals with `_` and
 * passes /^_[a-z]/; names that must survive (interop wire formats like `_$litType$`, DOM contracts
 * like `handleEvent`, public API like core's `_delete`) simply do not match the pattern.
 * Deliberately opt-in per package: core's `_hooks`/`_isSignal`/`_delete` are cross-boundary
 * contracts and must never be mangled.
 */
/**
 * @param options.input Entry file (default `src/index.ts`) — secondary entries like the
 * renderer's `hydrate` build pass their own.
 * @param options.alwaysExternal Specifiers kept external in **every** mode, production included.
 *
 * Production normally inlines everything so each `.min.js` stands alone, which is right for a
 * module that shares no runtime state with core — `@verajs/styles` and `@verajs/spread` import
 * nothing and are wired by the app. It is wrong for a module built *on* core's API: inlining would
 * give a CDN page a second copy of core, and with it a second insert registry and a second store
 * identity. `@verajs/computed` calls `createStore` and `createHook`, so core stays external and
 * resolves through the import map to the one everything else is using.
 */
export const defaultRollupConfig = (fileName, dependencies, manglePropsRegex, options = {}) => {
  const mode = process.env.MODE;
  const isProduction = mode === 'prod';
  const isTypes = mode === 'types';

  const file = fileName + (isProduction ? '.min.js' : isTypes ? '.d.ts' : '.js');

  /**
   * `__DEV__` is folded to a literal before terser runs, so development-only code — the profiler
   * instrumentation among it — costs production zero bytes. Terser's `dead_code` then deletes
   * `if (false) { … }` outright. A tiny plugin rather than @rollup/plugin-replace: the repo ships
   * no runtime dependencies and there is no reason for the build to grow one for six lines.
   *
   * Guard development-only work as `if (__DEV__) { … }` at statement level. That is the shape
   * terser eliminates cleanly; a `__DEV__ &&` expression inside a hot path survives as a
   * conditional in the AST until terser folds it, which it does, but the statement form is the one
   * to reach for so the intent reads.
   */
  const defineDev = () => {
    return {
      name: 'define-dev',
      /**
       * **Padded to the same width, and that is what makes `map: null` true.**
       *
       * `map: null` tells Rollup this transform moved nothing, so the map it already has still
       * applies. A bare `true`/`false` is shorter than `__DEV__`, which shifts every column after it
       * on that line — small, but the same lie the two comment strippers below were telling in
       * whole lines. Terser removes the padding from the production bundle, and a development bundle
       * carries two spaces per occurrence in exchange for a map that lands on the right character.
       */
      renderChunk(code) {
        const replacement = (isProduction ? 'false' : 'true').padEnd('__DEV__'.length);
        return { code: code.replace(/\b__DEV__\b/g, replacement), map: null };
      },
    };
  };

  const removeEslintComments = () => {
    return {
      name: 'remove-eslint-comments',
      /**
       * **Emptied, not deleted** — see `remove-todo-comments` below for why.
       */
      renderChunk(code) {
        return { code: code.replace(/\/\/\s*eslint-disable-next-line.*\n/g, '\n'), map: null };
      },
    };
  };

  const removeTodoComments = () => {
    return {
      name: 'remove-todo-comments',
      /**
       * **Emptied, not deleted, so the line count does not change.**
       *
       * `map: null` is a claim that this transform moved nothing and Rollup's existing map still
       * applies. Removing a whole line breaks that claim for **every line after it**, and the map
       * was wrong by exactly that much: five `eslint-disable-next-line` comments in the sources put
       * `@verajs/core` and `@verajs/renderer`'s dev maps one line out — verified by asking the map
       * where `const untrack` came from and getting the `*​/` above it.
       *
       * Leaving a blank line makes the claim true. Terser deletes it from the production bundle, and
       * the point of stripping these was never the byte, it was not shipping the comment.
       */
      renderChunk(code) {
        return { code: code.replace(/.*\/\/\s*TODO.*\n/g, '\n'), map: null };
      },
    };
  };

  return {
    input: options.input ?? 'src/index.ts',
    output: {
      file: isProduction ? `dist/${file}` : `dist/development/${file}`,
      format: 'es',
      sourcemap: true,
      /**
       * **Rollup's own relative paths land outside the repository.** Measured: every `sources` entry
       * in every map resolved to somewhere above the checkout — `../../../../src/store/store.ts`
       * from `packages/core/dist/` is `/Users/omni/dev/src/…`, and the development maps were a level
       * further out again. Nothing *broke*, because `sourcesContent` is embedded and a browser
       * prefers it, but anything that resolves `sources` on disk — an error reporter, a bundler
       * consuming the map, an editor — got nothing, and a published path naming a directory tree
       * that only exists on one machine is wrong on its own terms.
       *
       * The tail after the leading `../`s is right; only the climb is wrong. So it is rebuilt from
       * the package this build is running in: `src/…` for the package's own files and `<pkg>/src/…`
       * for a workspace dependency that was inlined. A path that resolves to nothing is left exactly
       * as Rollup produced it rather than replaced with a different guess.
       */
      sourcemapPathTransform: (relativePath, sourcemapPath) => {
        const tail = relativePath.replace(/^(\.\.\/)+/, '');
        for (const base of [process.cwd(), dirname(process.cwd())]) {
          const absolute = resolve(base, tail);
          if (existsSync(absolute)) return relative(dirname(sourcemapPath), absolute);
        }
        return relativePath;
      },
    },
    external: !isProduction ? (dependencies ?? []) : (options.alwaysExternal ?? []),
    plugins: [
      defineDev(),
      typescript({
        outDir: isProduction ? 'dist/' : 'dist/development/',
        compilerOptions: {
          composite: false,
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
        },
      }),
      isProduction &&
        terser({
          output: {
            comments: false,
          },
          mangle: manglePropsRegex ? { properties: { regex: manglePropsRegex } } : {},
          compress: {
            /**
             * Only `log`. `console.error`/`warn` are how the library reports real failures to a
             * consumer — the autoloader's "Failed to load custom element" among them — and
             * `drop_console: true` would silence those too.
             */
            drop_console: ['log'],
            drop_debugger: true,
            passes: 3,
          },
        }),
      removeEslintComments(),
      removeTodoComments(),
      isTypes &&
        dts({
          compilerOptions: { composite: false },
        }),
    ],
  };
};
