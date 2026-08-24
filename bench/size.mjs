/**
 * Bundle-size comparison against competing libraries.
 *
 * Sizes are measured the way a consumer actually gets them: a minimal but *working* app is bundled
 * per framework with esbuild (minified, `NODE_ENV=production`, tree-shaken), then gzipped. Gzipping
 * a raw `dist` file instead would be unfair in both directions — it ignores tree-shaking, and it
 * ignores the fact that some libraries need two packages to render anything.
 *
 * Every entry below imports *and uses* what it needs to put reactive state on screen, so nothing is
 * shaken away that a real app would keep.
 *
 *   npm run build && node bench/size.mjs
 */
import { gzipSync } from 'node:zlib';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
/** esbuild ships nested under vite here; resolve by path since vite does not export it. */
const esbuild = require(process.cwd() + '/node_modules/esbuild/lib/main.js');

/** Each entry renders reactive state, so the measurement covers a usable app rather than an import. */
const CONTENDERS = [
  {
    name: 'VeraJS + own renderer',
    note: 'core + @verajs/renderer',
    code: `
      import { init, createStore, render, setRenderer, html } from '@verajs/core';
      import { render as domRender } from '@verajs/renderer';
      setRenderer(domRender);
      // no setHtml needed: core's built-in html tag produces the shape the renderer accepts
      customElements.define('x-app', class extends HTMLElement {
        connectedCallback() {
          init(this, { mode: 'open' });
          const s = createStore({ n: 0 });
          render(() => html\`<button @click=\${() => s.n++}>\${s.n}</button>\`);
        }
      });`,
  },
  {
    name: 'VeraJS + lit-html',
    note: 'core + lit-html',
    code: `
      import { init, createStore, render, setHtml, setRenderer } from '@verajs/core';
      import { html, render as litRender } from 'lit-html';
      setHtml(html); setRenderer(litRender);
      customElements.define('x-app', class extends HTMLElement {
        connectedCallback() {
          init(this, { mode: 'open' });
          const s = createStore({ n: 0 });
          render(() => html\`<button @click=\${() => s.n++}>\${s.n}</button>\`);
        }
      });`,
  },
  {
    name: 'Lit',
    note: 'lit (LitElement + lit-html)',
    code: `
      import { LitElement, html } from 'lit';
      class XApp extends LitElement {
        static properties = { n: {} };
        constructor() { super(); this.n = 0; }
        render() { return html\`<button @click=\${() => this.n++}>\${this.n}</button>\`; }
      }
      customElements.define('x-app', XApp);`,
  },
  {
    name: 'Van.js',
    note: 'vanjs-core',
    code: `
      import van from 'vanjs-core';
      const { button } = van.tags;
      const n = van.state(0);
      van.add(document.body, button({ onclick: () => n.val++ }, n));`,
  },
  {
    name: 'Preact + signals',
    note: 'preact + @preact/signals-core',
    code: `
      import { h, render } from 'preact';
      import { signal, effect } from '@preact/signals-core';
      const n = signal(0);
      effect(() => { render(h('button', { onClick: () => n.value++ }, n.value), document.body); });`,
  },
  {
    name: 'Solid',
    note: 'solid-js runtime + web (needs a compiler)',
    code: `
      import { createSignal, createEffect } from 'solid-js';
      import { render, template, insert } from 'solid-js/web';
      const [n, setN] = createSignal(0);
      render(() => {
        const el = template('<button></button>')();
        el.addEventListener('click', () => setN(n() + 1));
        insert(el, n);
        return el;
      }, document.body);`,
  },
  {
    name: 'Vue',
    note: 'vue runtime + reactivity',
    code: `
      import { createApp, ref, h } from 'vue';
      createApp({
        setup() { const n = ref(0); return () => h('button', { onClick: () => n.value++ }, n.value); },
      }).mount(document.body);`,
  },
  {
    name: 'Alpine.js',
    note: 'alpinejs — attribute-driven, not components',
    code: `
      import Alpine from 'alpinejs';
      window.Alpine = Alpine;
      Alpine.start();`,
  },
  {
    name: 'petite-vue',
    note: 'petite-vue — buildless Vue subset',
    code: `
      import { createApp } from 'petite-vue';
      createApp({ count: 0, inc() { this.count++; } }).mount();`,
  },
  {
    name: 'React',
    note: 'react + react-dom',
    code: `
      import { useState, createElement } from 'react';
      import { createRoot } from 'react-dom/client';
      function App() {
        const [n, setN] = useState(0);
        return createElement('button', { onClick: () => setN(n + 1) }, n);
      }
      createRoot(document.body).render(createElement(App));`,
  },
];

/**
 * Entries live inside the repo, not the OS temp dir: esbuild resolves bare specifiers relative to
 * the importing file, so an entry outside the project cannot see `node_modules`.
 */
const dir = mkdtempSync(join(process.cwd(), 'bench', '.size-'));
const results = [];

for (const c of CONTENDERS) {
  const entry = join(dir, `${c.name.replace(/[^a-z0-9]+/gi, '-')}.js`);
  writeFileSync(entry, c.code);
  try {
    const out = await esbuild.build({
      entryPoints: [entry],
      /** Bypass root tsconfig `paths` so @verajs/* resolves to the shipped dist min, not TS source. */
      tsconfigRaw: '{}',
      bundle: true,
      minify: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      write: false,
      absWorkingDir: process.cwd(),
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'silent',
    });
    const bytes = out.outputFiles[0].contents;
    results.push({ ...c, raw: bytes.length, gzip: gzipSync(bytes).length });
  } catch (err) {
    results.push({ ...c, error: err.message.split('\n')[0].slice(0, 70) });
  }
}
rmSync(dir, { recursive: true, force: true });

const ok = results.filter((r) => !r.error).sort((a, b) => a.gzip - b.gzip);
const smallest = ok[0]?.gzip ?? 1;
const pad = Math.max(...results.map((r) => r.name.length));

console.log('\n  Minimal working app: reactive counter, bundled + minified + gzipped\n');
console.log(`  ${'Framework'.padEnd(pad)}  ${'raw'.padStart(8)}  ${'gzip'.padStart(8)}  vs smallest`);
console.log(`  ${'-'.repeat(pad)}  ${'-'.repeat(8)}  ${'-'.repeat(8)}  ${'-'.repeat(11)}`);
for (const r of ok) {
  const x = (r.gzip / smallest).toFixed(1);
  console.log(
    `  ${r.name.padEnd(pad)}  ${String(r.raw).padStart(8)}  ${String(r.gzip).padStart(8)}  ${(x + 'x').padStart(11)}`
  );
}
for (const r of results.filter((r) => r.error)) {
  console.log(`  ${r.name.padEnd(pad)}  FAILED: ${r.error}`);
}
console.log('');
for (const r of ok) console.log(`  ${r.name.padEnd(pad)}  ${r.note}`);
console.log('');

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(ok.map(({ name, note, raw, gzip }) => ({ name, note, raw, gzip })), null, 2));
}

/**
 * `--snapshot` commits these results so the docs can be generated without the nine competing
 * frameworks installed. The per-module sizes are recorded alongside, so `sync-size-claims.mjs`
 * can tell whether the snapshot still describes the current build: if `dist` has moved and the
 * snapshot has not, the comparative table is stale and CI says so.
 */
if (process.argv.includes('--snapshot')) {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const DIST = {
    core: 'packages/core/dist/vera.min.js',
    renderer: 'packages/renderer/dist/vera-renderer.min.js',
    router: 'packages/router/dist/vera-router.min.js',
    autoloader: 'packages/autoloader/dist/vera-autoloader.min.js',
    styles: 'packages/styles/dist/vera-styles.min.js',
    spread: 'packages/renderer/dist/vera-renderer-spread.min.js',
    tag: 'packages/renderer/dist/vera-renderer-tag.min.js',
    computed: 'packages/reactivity/dist/vera-reactivity-computed.min.js',
    inserts: 'packages/inserts/dist/vera-inserts.min.js',
  };
  const modules = {};
  for (const [pkg, file] of Object.entries(DIST)) {
    const buf = readFileSync(file);
    modules[pkg] = { raw: buf.length, gzip: gzipSync(buf).length };
  }
  /**
   * Transitive runtime dependency count per contender. Walks `dependencies` only — devDependencies
   * are irrelevant to what a consumer installs. Resolution checks bench/node_modules first, then
   * the repo root, matching how the bundler above resolves them.
   */
  const { existsSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const BENCH = dirname(fileURLToPath(import.meta.url));
  const manifest = (name) => {
    for (const base of [join(BENCH, 'node_modules', name), join(process.cwd(), 'node_modules', name)]) {
      const pj = join(base, 'package.json');
      if (existsSync(pj)) return JSON.parse(readFileSync(pj, 'utf8'));
    }
    return null;
  };
  const countDeps = (roots) => {
    const stack = [...roots];
    const seen = new Set();
    let unresolved = 0;
    while (stack.length) {
      const n = stack.pop();
      if (seen.has(n)) continue;
      const pj = manifest(n);
      if (!pj) {
        // Never report a count that silently skipped a package it could not find.
        unresolved++;
        continue;
      }
      if (!roots.includes(n)) seen.add(n);
      stack.push(...Object.keys(pj.dependencies ?? {}));
    }
    /**
     * First-party packages are split out. `@verajs/core` depends on `@verajs/inserts`, so a bare
     * total would read as "1 dependency" and invite exactly the correction the claim is trying to
     * survive. Third-party count is the number that means anything to a consumer auditing a tree.
     */
    const thirdParty = [...seen].filter((n) => !n.startsWith('@verajs/')).sort();
    return { count: seen.size, thirdParty, unresolved };
  };

  /** Bare specifiers each contender's app imports, i.e. what a consumer installs. */
  const ROOTS = {
    'VeraJS + own renderer': ['@verajs/core', '@verajs/renderer'],
    'VeraJS + lit-html': ['@verajs/core', 'lit-html'],
    Lit: ['lit'],
    'Van.js': ['vanjs-core'],
    'Preact + signals': ['preact', '@preact/signals-core'],
    Solid: ['solid-js'],
    Vue: ['vue'],
    'Alpine.js': ['alpinejs'],
    'petite-vue': ['petite-vue'],
    React: ['react', 'react-dom'],
  };

  const out = {
    taken: new Date().toISOString().slice(0, 10),
    method: 'esbuild bundle, minified, NODE_ENV=production, tree-shaken, zlib.gzipSync',
    modules,
    apps: ok.map(({ name, note, raw, gzip }) => {
      const d = ROOTS[name] ? countDeps(ROOTS[name]) : null;
      return {
        name, note, raw, gzip,
        deps: d?.count ?? null,
        depsThirdParty: d?.thirdParty?.length ?? null,
        depsThirdPartyNames: d?.thirdParty ?? null,
        depsUnresolved: d?.unresolved ?? 0,
      };
    }),
  };
  const bad = out.apps.filter((a) => a.depsUnresolved > 0);
  if (bad.length) {
    console.error('  WARNING: unresolved packages while counting dependencies for:');
    for (const a of bad) console.error(`    ${a.name} (${a.depsUnresolved} unresolved)`);
    console.error('  The counts would understate. Run `cd bench && npm install`, then retry.');
    process.exit(1);
  }
  writeFileSync('bench/size-snapshot.json', JSON.stringify(out, null, 2) + '\n');
  console.log('  wrote bench/size-snapshot.json');
}
