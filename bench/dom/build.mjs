/**
 * Bundles the DOM benchmark into a single self-contained IIFE so it can run from a file:// URL or a
 * published page with no network access — the frameworks under test are inlined, not fetched.
 */
import { createRequire } from 'node:module';
import { writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { harnessSha } from './harness-sha.mjs';

const require = createRequire(import.meta.url);
const esbuild = require(process.cwd() + '/node_modules/esbuild/lib/main.js');

/**
 * Svelte needs compiling — `.svelte` components through `compile`, `.svelte.js` rune modules
 * through `compileModule`. Everything else in this benchmark is plain JS, so this is the only
 * framework that needs a build step, which is itself worth knowing when reading the results.
 */
const sveltePlugin = () => ({
  name: 'svelte',
  setup(build) {
    let compiler;
    build.onLoad({ filter: /\.svelte$/ }, async (args) => {
      compiler ??= await import(process.cwd() + '/bench/node_modules/svelte/src/compiler/index.js');
      const { readFileSync } = await import('node:fs');
      const source = readFileSync(args.path, 'utf8');
      const { js } = compiler.compile(source, { filename: args.path, generate: 'client' });
      return { contents: js.code, loader: 'js' };
    });
    build.onLoad({ filter: /\.svelte\.js$/ }, async (args) => {
      compiler ??= await import(process.cwd() + '/bench/node_modules/svelte/src/compiler/index.js');
      const { readFileSync } = await import('node:fs');
      const source = readFileSync(args.path, 'utf8');
      const { js } = compiler.compileModule(source, { filename: args.path, generate: 'client' });
      return { contents: js.code, loader: 'js' };
    });
  },
});

/**
 * Solid compiled the way Solid ships: babel-preset-solid (bench/ devDependency), so "Solid" in the table is the
 * framework at its best (templates cloned, fine-grained bindings), not hyperscript. 2026-10-18: the race had been
 * comparing Vera against `solid-js/h`, a weaker Solid on every row.
 */
const solidPlugin = () => ({
  name: 'solid',
  setup(build) {
    build.onLoad({ filter: /\.jsx$/ }, async (args) => {
      const babel = require(process.cwd() + '/bench/node_modules/@babel/core');
      const { readFileSync } = await import('node:fs');
      const { code } = await babel.transformAsync(readFileSync(args.path, 'utf8'), {
        filename: args.path,
        babelrc: false,
        configFile: false,
        presets: [[process.cwd() + '/bench/node_modules/babel-preset-solid', { generate: 'dom' }]],
      });
      return { contents: code, loader: 'js' };
    });
  },
});

/**
 * Vue single-file components compiled the way Vue ships them (`@vitejs/plugin-vue` in production): the template
 * inlined into the setup function, with patch flags, hoisting and v-memo.
 */
const vuePlugin = () => ({
  name: 'vue',
  setup(build) {
    build.onLoad({ filter: /\.vue$/ }, async (args) => {
      const sfc = require(process.cwd() + '/bench/node_modules/@vue/compiler-sfc');
      const { readFileSync } = await import('node:fs');
      const { dirname } = await import('node:path');
      const { descriptor } = sfc.parse(readFileSync(args.path, 'utf8'), { filename: args.path });
      const { content } = sfc.compileScript(descriptor, { id: 'bench', inlineTemplate: true, isProd: true });
      return { contents: content, loader: 'js', resolveDir: dirname(args.path) };
    });
  },
});

/**
 * **`VERA_TREE=<work tree>`: the Vera under test comes from another tree** (2026-11-08): every `@verajs/*` import resolves
 * from that tree's `node_modules`, while the harness (`main.js`, `impls.js`) and the competitors stay this tree's. One
 * harness then builds every arm, so arms cannot drift apart by copies of it.
 */
const veraTree = process.env.VERA_TREE ? realpathSync(process.env.VERA_TREE) : realpathSync(process.cwd());
const veraTreePlugin = () => ({
  name: 'vera-tree',
  setup(build) {
    build.onResolve({ filter: /^@verajs\// }, (args) =>
      args.pluginData === 'vera-tree' ? undefined : build.resolve(args.path, { kind: args.kind, resolveDir: veraTree, pluginData: 'vera-tree' }));
  },
});

const out = await esbuild.build({
  entryPoints: ['bench/dom/main.js'],
  /**
   * Resolve @verajs/* through package `exports` to the SHIPPED dist builds. The root tsconfig's
   * `paths` map would otherwise hijack bare specifiers straight to TypeScript source, so the
   * bench would measure un-mangled source instead of what a CDN/npm consumer actually runs.
   */
  tsconfigRaw: '{}',
  bundle: true,
  minify: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  write: false,
  absWorkingDir: process.cwd(),
  /** Vue's feature flags as `@vitejs/plugin-vue` sets them for production; undefined, Vue falls back at runtime. */
  /** The harness sources' hash, stamped in: the race refuses a bundle built from other sources than the ones on disk. */
  define: { __HARNESS__: JSON.stringify(harnessSha()), 'process.env.NODE_ENV': '"production"', __VUE_OPTIONS_API__: 'true', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' },
  plugins: [veraTreePlugin(), sveltePlugin(), solidPlugin(), vuePlugin()],
  metafile: true,
});

/**
 * Every Vera module in the bundle must come from `veraTree`, and core exactly once (CLAUDE.md: a bundle can split core
 * into two copies, and reactivity then looks dead). Paths are realpaths, so a symlinked `node_modules` cannot hide it.
 */
const veraInputs = Object.keys(out.metafile.inputs).map((path) => realpathSync(join(process.cwd(), path))).filter((path) => /\/packages\/[^/]+\/dist\//.test(path));
const foreign = veraInputs.filter((path) => !path.startsWith(veraTree + '/'));
if (foreign.length) throw new Error(`bench build: Vera modules from outside ${veraTree}: ${foreign.join(', ')}`);
/**
 * Core's core exactly once. `@verajs/lite` (its own package since 2026-11-17) shares no state with core by design (no
 * registry, no store), so one beside core is a page loading two products, not core split in two; it is still held to at
 * most once.
 */
const cores = veraInputs.filter((path) => /\/packages\/core\/dist\/(development\/)?vera\.(min\.)?js$/.test(path));
if (cores.length !== 1) throw new Error(`bench build: ${cores.length} copies of core in the bundle (${cores.join(', ')})`);
const lites = veraInputs.filter((path) => /\/packages\/lite\/dist\/(development\/)?vera-lite\.(min\.)?js$/.test(path));
if (lites.length > 1) throw new Error(`bench build: ${lites.length} copies of @verajs/lite in the bundle (${lites.join(', ')})`);
const strays = veraInputs.filter((path) => /\/packages\/core\/dist\//.test(path) && !/\/vera\.(min\.)?js$/.test(path));
if (strays.length) throw new Error(`bench build: core modules that are no entry: ${strays.join(', ')}`);
console.log(`  vera from ${veraTree}: core ${cores[0].slice(veraTree.length + 1)}, ${veraInputs.length} Vera modules`);

const code = out.outputFiles[0].text;
/** Named once: the log said `-> undefined` whenever the destination came from the default. */
const destination = process.argv[2] ?? 'bench/dom/bundle.js';
writeFileSync(destination, code);
console.log(`  bundled ${code.length} B raw, ${gzipSync(code).length} B gzip -> ${destination}`);
