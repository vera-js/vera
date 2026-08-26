/**
 * Bundles the DOM benchmark into a single self-contained IIFE so it can run from a file:// URL or a
 * published page with no network access — the frameworks under test are inlined, not fetched.
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

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
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [sveltePlugin()],
});

const code = out.outputFiles[0].text;
/** Named once: the log said `-> undefined` whenever the destination came from the default. */
const destination = process.argv[2] ?? 'bench/dom/bundle.js';
writeFileSync(destination, code);
console.log(`  bundled ${code.length} B raw, ${gzipSync(code).length} B gzip -> ${destination}`);
