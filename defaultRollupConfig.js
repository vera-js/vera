import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import { dts } from 'rollup-plugin-dts';

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
 * Every entry bundles self-contained in every mode.
 */
export const defaultRollupConfig = (fileName, dependencies, manglePropsRegex, options = {}) => {
  // eslint-disable-next-line no-undef
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
      renderChunk(code) {
        return { code: code.replace(/\b__DEV__\b/g, isProduction ? 'false' : 'true'), map: null };
      },
    };
  };

  const removeEslintComments = () => {
    return {
      name: 'remove-eslint-comments',
      renderChunk(code) {
        // Regex to remove all eslint-disable comments
        const cleanedCode = code.replace(/\/\/\s*eslint-disable-next-line.*\n/g, '');
        return {
          code: cleanedCode,
          map: null,
        };
      },
    };
  };

  const removeTodoComments = () => {
    return {
      name: 'remove-todo-comments',
      renderChunk(code) {
        const cleanedCode = code.replace(/.*\/\/\s*TODO.*\n/g, '');
        return {
          code: cleanedCode,
          map: null,
        };
      },
    };
  };

  return {
    input: options.input ?? 'src/index.ts',
    output: {
      file: isProduction ? `dist/${file}` : `dist/development/${file}`,
      format: 'es',
      sourcemap: true,

    },
    external: !isProduction ? dependencies ?? [] : [],
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
