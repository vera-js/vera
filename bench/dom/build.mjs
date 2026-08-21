/**
 * Bundles the DOM benchmark into a single self-contained IIFE so it can run from a file:// URL or a
 * published page with no network access — the frameworks under test are inlined, not fetched.
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const esbuild = require(process.cwd() + '/node_modules/esbuild/lib/main.js');

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
});

const code = out.outputFiles[0].text;
writeFileSync(process.argv[2] ?? 'bench/dom/bundle.js', code);
console.log(`  bundled ${code.length} B raw, ${gzipSync(code).length} B gzip -> ${process.argv[2]}`);
