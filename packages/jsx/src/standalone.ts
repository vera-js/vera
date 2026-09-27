/**
 * @verajs/jsx/standalone — JSX in the browser with no build step, including apps split across files.
 *
 * `<script type="text/vera-jsx">` blocks, inline or `src`, are compiled in the page and run as real ES
 * modules. A file they import is loaded the same way, relative imports and all, so a self-hosted app
 * is ordinary `.jsx` and `.js` files beside its page:
 *
 *   <script type="importmap"> { "imports": {
 *     "@verajs/core":     "/vendor/core/vera.min.js",
 *     "@verajs/renderer": "/vendor/renderer/vera-renderer.min.js",
 *     "@verajs/jsx":      "/vendor/jsx/vera-jsx-standalone.min.js"
 *   } } </script>
 *   <script type="module">import '@verajs/jsx';</script>
 *   <script type="text/vera-jsx" src="/app/main.jsx"></script>
 *
 * **What it does per file**: fetch it, compile it (JSX files) or take it as is (JS files), rewrite its
 * relative imports to the compiled files they name, and run the result from a blob URL. A relative
 * import of anything else — `./data.json` `with { type: 'json' }`, a CSS module — is pointed at its
 * real address and left to the browser. Every `import(…)` and `import.meta` goes through this loader
 * with the file's real address (after redirects), so a template literal, a computed path, import
 * options and `import.meta.resolve` all work as written. Package names
 * are left to the page's import map — except `@verajs/renderer`'s own entries (`keyed`, `spread`
 * and `namespaces`, which compiled JSX imports, and `slots`, `tag` or `hydrate`, which an app
 * imports), which are loaded from beside wherever the map puts `@verajs/renderer`, so the map stays
 * three lines. Copy the renderer's whole `dist` folder.
 *
 * **What it costs**, measured on a 40-module app: within ~7–12 ms of the same app precompiled, in
 * Chromium, Firefox and WebKit. A Service Worker was measured too and rejected: Firefox charges every
 * request routed through one ~0.7 ms, with no static routing to avoid it.
 *
 * **Repeat visits compile nothing.** Each JSX file's compiled output is kept in `localStorage`, keyed
 * by its URL, validated by the ETag its server sends — or its `Last-Modified`, which is all
 * `python3 -m http.server` sends — and stamped with this package's version; a plain JS file keeps
 * only where its imports are, since its text comes back from the HTTP cache, so vendored libraries
 * cannot fill the storage. The compiler itself (`vera-jsx.min.js`, beside this file) is imported only
 * when something must be compiled. A file with neither header, and an inline block, is compiled every
 * time.
 *
 * **Not supported: circular imports.** A blob URL exists only once its content does, so two files
 * cannot name each other; the cycle is reported with its chain. Use the Vite plugin for those.
 * Production still prefers the plugin, which ships no compiler at all.
 */
import type { ImportSite } from './types.js';

/** The compiler's two functions, from `vera-jsx(.min).js` — loaded only when something must compile. */
type Compiler = {
  transformJsx: (code: string, fileName: string) => string;
  importSites: (code: string) => ImportSite[];
};
/** A file ready to link: its JavaScript and where its imports are in it. */
type Compiled = { js: string; sites: ImportSite[] };
/** What the cache keeps: a JS file's text is not kept — the HTTP cache already has it. */
type Kept = { etag: string; sites: ImportSite[]; js?: string };

const COMPILER = new URL(__DEV__ ? './vera-jsx.js' : './vera-jsx.min.js', import.meta.url).href;
let compiler: Promise<Compiler> | undefined;
const loadCompiler = (): Promise<Compiler> => (compiler ??= import(/* @vite-ignore */ COMPILER) as Promise<Compiler>);

const CACHE = `vera-jsx@${__VERSION__}:`;
const recall = (url: string, etag: string | null): Kept | null => {
  if (etag === null) return null;
  try {
    const hit = JSON.parse(localStorage.getItem(CACHE + url) ?? 'null') as Kept | null;
    return hit !== null && hit.etag === etag ? hit : null;
  } catch {
    return null;
  }
};
const remember = (url: string, etag: string | null, { js, sites }: Compiled): void => {
  if (etag === null) return;
  try {
    localStorage.setItem(CACHE + url, JSON.stringify(isJsx(url) ? { etag, sites, js } : { etag, sites }));
  } catch {
    /** Full or blocked storage only means compiling again next time. */
  }
};
/** Entries another version of the compiler wrote: its output must never be served under this one. */
const forgetOtherVersions = (): void => {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key !== null && key.startsWith('vera-jsx@') && !key.startsWith(CACHE)) localStorage.removeItem(key);
    }
  } catch {
    /** Blocked storage has nothing to forget. */
  }
};

/**
 * **Any `@verajs/renderer/<entry>`, resolved beside the page's `@verajs/renderer`** — every entry is
 * `vera-renderer-<entry>(.min).js` in the same folder — unless the import map names it itself, in
 * which case the name is left for it. Returns `null` for anything else, which stays a bare
 * specifier. Only files this loader loads are rewritten: a plain `<script type="module">` importing
 * `@verajs/renderer/slots` is resolved by the browser, from the map. The profiler has no
 * production build, so a page on the `.min.js` files maps it explicitly.
 */
const RENDERER_ENTRY = /^@verajs\/renderer\/([a-z]+)$/;
let mapped: Record<string, string> | undefined;
const helperUrl = (specifier: string): string | null => {
  const helper = RENDERER_ENTRY.exec(specifier)?.[1];
  if (helper === undefined) return null;
  if (mapped === undefined) {
    /** EVERY map, merged first-wins as engines that allow several merge them — not the first alone. */
    mapped = {};
    for (const map of document.querySelectorAll('script[type="importmap"]')) {
      try {
        const imports = (JSON.parse(map.textContent ?? '{}') as { imports?: Record<string, string> }).imports ?? {};
        for (const name in imports) mapped[name] ??= imports[name];
      } catch {
        /** A malformed map is the browser's to report. */
      }
    }
  }
  if (mapped[specifier] !== undefined || mapped['@verajs/renderer'] === undefined) return null;
  const renderer = new URL(mapped['@verajs/renderer'], document.baseURI);
  const url = new URL(`vera-renderer-${helper}${renderer.pathname.endsWith('.min.js') ? '.min' : ''}.js`, renderer).href;
  helpers.add(url);
  return url;
};
/** Every helper file handed out, so a failure can say which of them is missing — see `runBlock`. */
const helpers = new Set<string>();

const RELATIVE = /^(?:\.{1,2})?\//;
const isJsx = (url: string): boolean => /\.[jt]sx$/.test(new URL(url).pathname);
/**
 * **Whether this loader loads a file, or the browser does.** Scripts — `.js`, `.mjs`, `.jsx`, `.tsx`,
 * and anything with no extension — are loaded here, because any of them may import JSX. Anything else
 * (`.json`, `.css`, `.wasm`) is the browser's: wrapped as a JavaScript blob, a JSON module failed its
 * MIME check and named only a `blob:` URL.
 */
const isScript = (url: string): boolean => !/\.(?!m?js$|[jt]sx$)[^./]+$/.test(new URL(url).pathname);

/** url → blob URL of its linked module; each file is fetched, compiled and linked once per page. */
const modules = new Map<string, Promise<string>>();

/**
 * **Which files are waiting on which, right now** — the cycle check. It has to be this graph and not
 * the import path that led to a file: an entry importing both `a` and `b`, which import each other,
 * fetches them in parallel from two different paths, and each would wait for the other forever. A
 * new wait that closes a loop in this graph is a cycle, and is reported with the loop.
 */
const waiting = new Map<string, Set<string>>();
const loopBack = (from: string, to: string, seen = new Set<string>()): string[] | null => {
  if (from === to) return [to];
  for (const next of waiting.get(from) ?? []) {
    if (seen.has(next)) continue;
    seen.add(next);
    const rest = loopBack(next, to, seen);
    if (rest !== null) return [from, ...rest];
  }
  return null;
};

const fetchFile = async (url: string, importer: string): Promise<Response> => {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error(`[vera] jsx: could not fetch ${url}, imported by ${importer}.`);
  }
  if (!response.ok)
    throw new Error(
      `[vera] jsx: ${url} answered ${response.status}, imported by ${importer}. A self-hosted page ` +
        `needs every file it imports beside it — for @verajs/renderer's helpers, its whole dist folder.`
    );
  return response;
};

const compile = async (url: string, source: string): Promise<Compiled> => {
  const { transformJsx, importSites } = await loadCompiler();
  const js = isJsx(url) ? transformJsx(source, url) : source;
  return { js, sites: importSites(js) };
};

/**
 * One file's JavaScript with its imports pointed at what they name: a relative static import at the
 * linked module (or, for a non-script, at its real address), a renderer helper beside the renderer,
 * every `import(` at this loader's resolver and every `import.meta` at the file's own — both given
 * `base`, the file's real address, so a dynamic import loads lazily and resolves as written.
 */
const link = async (base: string, name: string, { js, sites }: Compiled): Promise<string> => {
  const at = JSON.stringify(base);
  const edits = await Promise.all(
    sites.map(async (site): Promise<[number, number, string] | null> => {
      if (site.kind === 'meta') return [site.start, site.end, `globalThis.__veraJsxMeta(${at})`];
      if (site.kind === 'dynamic') return [site.start, site.end, `globalThis.__veraJsx(${at},`];
      if (RELATIVE.test(site.specifier)) {
        const target = new URL(site.specifier, base).href;
        if (!isScript(target)) return [site.start, site.end, target];
        const loop = loopBack(target, name);
        if (loop !== null)
          throw new Error(
            `[vera] jsx: circular import ${[name, ...loop].join(' → ')} — buildless mode cannot link a ` +
              `cycle (a blob URL exists only once its content does). Break it, or build with the Vite plugin.`
          );
        let waits = waiting.get(name);
        if (waits === undefined) waiting.set(name, (waits = new Set()));
        waits.add(target);
        return [site.start, site.end, await load(target, name)];
      }
      const helper = helperUrl(site.specifier);
      return helper === null ? null : [site.start, site.end, helper];
    })
  );
  waiting.delete(name);
  let out = js;
  for (let i = edits.length - 1; i >= 0; i--) {
    const edit = edits[i];
    if (edit !== null) out = out.slice(0, edit[0]) + edit[2] + out.slice(edit[1]);
  }
  /** DevTools and stack traces name the real file, not `blob:…`. */
  out += `\n//# sourceURL=${name}\n`;
  return URL.createObjectURL(new Blob([out], { type: 'text/javascript' }));
};

const load = (url: string, importer: string): Promise<string> => {
  let module = modules.get(url);
  if (module === undefined)
    modules.set(
      url,
      (module = (async () => {
        const response = await fetchFile(url, importer);
        const etag = response.headers.get('etag') ?? response.headers.get('last-modified');
        const kept = recall(url, etag);
        let compiled: Compiled;
        if (kept === null) {
          compiled = await compile(url, await response.text());
          remember(url, etag, compiled);
        } else compiled = { js: kept.js ?? (await response.text()), sites: kept.sites };
        /** Resolved against where the file really is: a redirected file's neighbours are THERE. */
        return link(response.url || url, url, compiled);
      })())
    );
  return module;
};

/**
 * **What every rewritten `import(` calls**, with the calling file's address: a relative script
 * through this loader, lazily, as written; anything else — a non-script, a renderer helper, a bare
 * name for the import map — through the browser, options and all.
 */
(globalThis as { __veraJsx?: unknown }).__veraJsx = async (base: string, specifier: unknown, options?: ImportCallOptions) => {
  const name = String(specifier);
  if (!RELATIVE.test(name)) return import(/* @vite-ignore */ helperUrl(name) ?? name, options);
  const target = new URL(name, base).href;
  return import(/* @vite-ignore */ isScript(target) ? await load(target, base) : target, options);
};
/**
 * **Each file's `import.meta`**: its real `url`, and a `resolve` that answers as the file itself would —
 * a relative name against that url, a package name through the page's import map.
 */
const metas = new Map<string, { url: string; resolve: (specifier: string) => string }>();
(globalThis as { __veraJsxMeta?: unknown }).__veraJsxMeta = (base: string) => {
  let meta = metas.get(base);
  if (meta === undefined)
    metas.set(
      base,
      (meta = {
        url: base,
        resolve: (specifier) =>
          RELATIVE.test(specifier) ? new URL(specifier, base).href : helperUrl(specifier) ?? import.meta.resolve(specifier),
      })
    );
  return meta;
};

let inline = 0;

/** Runs one `<script type="text/vera-jsx">` — a file by its `src`, or its own text against the page. */
const runBlock = async (script: HTMLScriptElement): Promise<void> => {
  try {
    if (script.src) {
      await import(/* @vite-ignore */ await load(script.src, document.baseURI));
      return;
    }
    const name = new URL(`inline-${++inline}.jsx`, document.baseURI).href;
    const compiled = await compile(name, script.textContent ?? '');
    await import(/* @vite-ignore */ await link(document.baseURI, name, compiled));
  } catch (error) {
    console.error(`[vera] jsx: ${script.src || 'an inline block'}:`, error);
    /**
     * **The browser loads the renderer's helpers itself**, so a missing one fails as an opaque
     * `blob:` import error that names nothing. Only on failure, each helper handed out is asked for.
     */
    for (const url of helpers) {
      const found = await fetch(url, { method: 'HEAD' }).then((response) => response.ok, () => false);
      if (!found)
        console.error(
          `[vera] jsx: ${url} was not found. The renderer's helpers are loaded from beside ` +
            `@verajs/renderer — copy its whole dist folder, or map the helper in the import map.`
        );
    }
  }
};

const boot = async (): Promise<void> => {
  forgetOtherVersions();
  /** Sequential, so blocks execute in document order like ordinary scripts. */
  for (const script of document.querySelectorAll<HTMLScriptElement>('script[type="text/vera-jsx"]')) await runBlock(script);
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void boot(), { once: true });
else void boot();

export { runBlock };
