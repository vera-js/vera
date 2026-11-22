/**
 * Resolves a built artifact for the condition under test.
 *
 * The suites run twice — once against `dist/development/*.js`, once against `dist/*.min.js` —
 * because those are different programs. Four transformations happen only in the production build:
 *
 *   1. **Property mangling.** `@verajs/renderer` renames every `/^_[a-z]/` property.
 *   2. **Dead-code elimination.** `__DEV__` folds to `false` and its branches are deleted.
 *   3. **`drop_console: ['log']`.** `console.log` calls are removed (`error`/`warn` survive).
 *   4. **Workspace inlining.** Development keeps `@verajs/inserts` as a real import; production
 *      copies it into each bundle — which is why two standalone bundles hold two registries and
 *      `connectInserts` exists at all.
 *
 * **A development bundle can still reach production code.** `dist/development/*.js` keeps workspace
 * deps external, so loading core's development bundle resolves `@verajs/inserts` through its
 * `exports` map — and with no `development` condition set, that lands on `dist/*.min.js`, where the
 * `__DEV__` guards are gone. A suite checking a development-only warning must therefore `load` the
 * package that *owns* the guard rather than reach it through a re-export, or it silently asserts
 * against the production build. A real app is unaffected: a bundler sets the condition.
 *
 * A suite that only ever loaded `dist/development` proved the logic and nothing about the artifact
 * that ships. Notably, `_p` in `@verajs/inserts` is a cross-bundle contract that a mangling regex
 * would silently rename; the development build cannot show that.
 *
 *   npm test                       # development
 *   VERA_DIST=production npm test  # production
 *   npm run test:all               # both
 *   npm run test:node-builds       # the node builds: jsx's compiler, cms's content (VERA_DIST=node)
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
export const isProduction = process.env.VERA_DIST === 'production';
/**
 * **`VERA_DIST=node`: each entry's NODE build where it has one (jsx's compiler, cms's content), everything else development** — the pairing a Vite or Node user
 * runs (`@verajs/jsx`'s `node` export condition maps `dist/node/vera-jsx.js`: production's pipeline, minified, with
 * `__DEV__` true). A third program, so the jsx suites run against it too (`npm run test:node-builds`, in the gate).
 */
export const isNodeBuild = process.env.VERA_DIST === 'node';
/** The entries with a `node` export condition — each a MODE=node build the suites also run (`npm run test:node-builds`). */
const NODE_BUILDS = new Set(['jsx', 'cms/content']);

/** Bundle name -> the `filename` its package.json declares. */
export const ENTRY = {
  'vera-components/tabs': ['components/tabs', 'vera-tabs'],
  'vera-components/tabs/element': ['components/tabs', 'vera-tabs-element'],
  'vera-components/spinner': ['components/spinner', 'vera-spinner'],
  'vera-components/spinner/element': ['components/spinner', 'vera-spinner-element'],
  'vera-components/input': ['components/input', 'vera-input'],
  'vera-components/input/element': ['components/input', 'vera-input-element'],
  'vera-components/kbd': ['components/kbd', 'vera-kbd'],
  'vera-components/kbd/element': ['components/kbd', 'vera-kbd-element'],
  'vera-components/field': ['components/field', 'vera-field'],
  'vera-components/field/element': ['components/field', 'vera-field-element'],
  'vera-hooks/labeled': ['hooks/labeled', 'vera-labeled'],
  'vera-hooks/roving-focus': ['hooks/roving-focus', 'vera-roving-focus'],
  'vera-hooks/roving-focus/internal': ['hooks/roving-focus', 'vera-roving-focus-internal'],
  'vera-hooks/announce': ['hooks/announce', 'vera-announce'],
  'vera-hooks/anchor': ['hooks/anchor', 'vera-anchor'],
  'vera-components/icon': ['components/icon', 'vera-icon'],
  'vera-components/icon/element': ['components/icon', 'vera-icon-element'],
  'vera-components/select': ['components/select', 'vera-select'],
  'vera-components/select/elements': ['components/select', 'vera-select-elements'],
  'vera-hooks/listbox': ['hooks/listbox', 'vera-listbox'],
  'vera-hooks/light-dismiss': ['hooks/light-dismiss', 'vera-light-dismiss'],
  'cms/content': ['cms', 'vera-cms-content'],
  'cms/publish': ['cms', 'vera-cms-publish'],
  'cms/node': ['cms', 'vera-cms-node'],
  'cms/cli': ['cms', 'vera-cms-cli'],
  core: ['core', 'vera'],
  lite: ['lite', 'vera-lite'],
  static: ['static', 'vera-static'],
  jsx: ['jsx', 'vera-jsx'],
  'jsx/standalone': ['jsx', 'vera-jsx-standalone'],
  renderer: ['renderer', 'vera-renderer'],
  'renderer/hydration': ['renderer', 'vera-renderer-hydration'],
  'renderer/hydrate-slots': ['renderer', 'vera-renderer-hydrate-slots'],
  'renderer/profiler': ['renderer', 'vera-renderer-profiler'],
  router: ['router', 'vera-router'],
  autoloader: ['autoloader', 'vera-autoloader'],
  inserts: ['inserts', 'vera-inserts'],
  'store/resource': ['store', 'vera-store-resource'],
  store: ['store', 'vera-store'],
  'renderer/keyed': ['renderer', 'vera-renderer-keyed'],
  'renderer/native-elements': ['renderer', 'vera-renderer-native-elements'],
  'renderer/multi-window': ['renderer', 'vera-renderer-multi-window'],
  'renderer/until': ['renderer', 'vera-renderer-until'],
  'renderer/slots': ['renderer', 'vera-renderer-slots'],
  'renderer/namespaces': ['renderer', 'vera-renderer-namespaces'],
  'renderer/elements': ['renderer', 'vera-renderer-elements'],
  'renderer/portal': ['renderer', 'vera-renderer-portal'],
  'renderer/spread': ['renderer', 'vera-renderer-spread'],
  'renderer/tag': ['renderer', 'vera-renderer-tag'],
  styles: ['styles', 'vera-styles'],
  directives: ['directives', 'vera-directives'],
  'directives/core': ['directives', 'vera-directives-core'],
  'directives/standalone': ['directives', 'vera-directives-standalone'],
  'directives/interactions': ['directives', 'vera-directives-interactions'],
  'directives/motion': ['directives', 'vera-directives-motion'],
  motion: ['motion', 'vera-motion'],
  'motion/internal': ['motion', 'vera-motion-internal'],
  'motion/ssr': ['motion', 'vera-motion-ssr'],
  'motion/client': ['motion', 'vera-motion-client'],
  'directives/remote': ['directives', 'vera-directives-remote'],
  'directives/query': ['directives', 'vera-directives-query'],
  'directives/sensors': ['directives', 'vera-directives-sensors'],
  'directives/expressions': ['directives', 'vera-directives-expressions'],
  'store/collections': ['store', 'vera-store-collections'],
  hot: ['hot', 'vera-hot'],
  /** The Vite adapter: Node-side tooling (the `node` export condition), built like every entry. */
  'hot/vite': ['hot', 'vera-hot-vite'],
};

/**
 * `@verajs/renderer/profiler` is deliberately not built for production — its instrumentation is
 * behind `__DEV__`, so a production profiler would measure code the build removed.
 */
export const NO_PRODUCTION_BUILD = new Set(['renderer/profiler']);

/**
 * The packages that publish `src` directly and have no `dist` at all, mapped to their entry file.
 * `@verajs/ssr` is the ONE exemption (see `CLAUDE.md`, *Source of truth rules*); `@verajs/jsx`
 * left this table in the conventions pass — it builds like every other package now.
 */
const UNBUILT = {};

/**
 * This file's own URL, in the path's CANONICAL case on Windows. Node keys a module by its exact URL, and Windows paths
 * are case-insensitive: started from `c:\…` (VS Code, Git Bash), `import.meta.url` is `file:///c:/…` while a bundle's
 * bare `@verajs/core` resolves through `node_modules` to `file:///C:/…`, two cores (`tests/dist-drive-case.test.mjs`).
 * `realpathSync.native` answers the file system's own spelling. Elsewhere the URL is left exactly as it was.
 */
const HERE = process.platform === 'win32' ? pathToFileURL(realpathSync.native(fileURLToPath(import.meta.url))).href : import.meta.url;

/** Absolute URL of a built bundle. `query` forces a fresh module instance (`?copy=a`). */
export const distUrl = (name, query = '') => {
  if (UNBUILT[name] !== undefined) return new URL(`../packages/${UNBUILT[name]}${query}`, HERE).href;
  const entry = ENTRY[name];
  if (entry === undefined) throw new Error(`tests/dist.mjs: unknown bundle "${name}"`);
  const [pkg, file] = entry;
  const path = isProduction ? `${file}.min.js` : isNodeBuild && NODE_BUILDS.has(name) ? `node/${file}.js` : `development/${file}.js`;
  return new URL(`../packages/${pkg}/dist/${path}${query}`, HERE).href;
};

/**
 * **`VERA_TIER=lite` or `static`: the renderer suites run against a small tier's SHIPPED bundle** (Brian, 2026-11-19: lite
 * and static go through every applicable core/renderer suite before their first publish). `load('core')` and
 * `load('renderer')` answer a facade: the tier's `html`/`svg`/`mathml`/`define`(/`signal`), a no-op `wire`, and a
 * `renderInto` built on a real component of the tier — never a test-only build. EVERY other export of core or the
 * renderer throws when called (`core-only`), so a suite can never pass under a tier by quietly running core: a row that
 * needs one is red, and is skipped by name with its reason (`tests/tier-skips.mjs`, run by `scripts/tier-suites.mjs`).
 *
 * - lite: one connected host per container, rendering INTO it (`_$r$`, the root sigil a component renders into); a
 *   later call re-renders synchronously through `connectedCallback()` (set-up hosts skip setup and patch), so updates
 *   are lite's own patching, in place. Hosts live in a holder outside `<body>` — a lite render needs a connected host.
 * - static: renders once, synchronously, into a fresh component, and its nodes MOVE into the container (static never
 *   touches them again). A second call is a fresh render: static has no updates, so update rows are skipped.
 */
export const tier = process.env.VERA_TIER;
/**
 * Under a tier: whether `error` is the tier saying "not here" — a `core-only` call or one of the tier's coded refusals.
 * A script-style suite that renders case after case uses it to count such a case and go on, so one refusal never hides
 * the cases behind it; anything else it throws is a failure, as it is under core.
 */
export const tierRefused = (error) =>
  tier !== undefined && /core-only:|tier-hole-position|static-hole|unfinished-tag|tier-needs-core/.test(String(error?.message ?? ''));
if (tier !== undefined && tier !== 'lite' && tier !== 'static') throw new Error(`tests/dist.mjs: VERA_TIER=${tier} is not lite or static`);
const coreOnly = (where, key) => () => {
  throw new Error(`core-only: ${where}'s \`${key}\` is not in @verajs/${tier}`);
};
/** A module's facade: `own` answered as given, every other function export a `core-only` thrower, other values as they are. */
const facade = (mod, where, own) =>
  new Proxy(own, {
    get: (target, key) => (key in target ? target[key] : typeof mod[key] === 'function' ? coreOnly(where, String(key)) : mod[key]),
    has: (target, key) => key in target || key in mod,
  });
let tierModule;
let current;
/**
 * Everything is taken from the CONTAINER's window, never the globals (CLAUDE.md: use the element's window): a suite may
 * replace `globalThis.document` after loading (importing `@verajs/ssr` installs its server DOM), and its containers come
 * from its own jsdom. Per window: the host is defined once — `define` reads the global registry and `HTMLElement`, so
 * they point at that window while it runs — and the hosts sit in a holder outside `<body>` (a lite render needs a
 * connected host). Defined at the first render, not at load: a renderer suite may set no registry global at all.
 */
const perWindow = new WeakMap();
const hostFor = (view) => {
  let entry = perWindow.get(view);
  if (entry === undefined) {
    const saved = [globalThis.customElements, globalThis.HTMLElement];
    globalThis.customElements = view.customElements;
    globalThis.HTMLElement = view.HTMLElement;
    try {
      tierModule.define('vera-tier-host', () => () => current);
    } finally {
      [globalThis.customElements, globalThis.HTMLElement] = saved;
    }
    perWindow.set(view, (entry = { hosts: new WeakMap(), holder: undefined }));
  }
  return entry;
};
const tierRenderInto = (result, container) => {
  current = result;
  const doc = container.ownerDocument ?? container;
  const view = doc.defaultView;
  const entry = hostFor(view);
  if (tier === 'static') {
    const element = doc.createElement('vera-tier-host');
    element.connectedCallback();
    container.replaceChildren(...element.childNodes);
    return;
  }
  const host = entry.hosts.get(container);
  if (host !== undefined) return host.connectedCallback();
  const made = doc.createElement('vera-tier-host');
  made._$r$ = container;
  entry.hosts.set(container, made);
  if (entry.holder === undefined || !entry.holder.isConnected) doc.documentElement.append((entry.holder = doc.createElement('vera-tier-holder')));
  /**
   * The first render runs in the connect REACTION, which reports an exception to the window instead of throwing it;
   * core's `renderInto` throws. So the reported error is caught and rethrown — a refusal reaches the row as core's would.
   */
  let reported;
  /**
   * Through the window's `onerror` PROPERTY, never `addEventListener`: a suite counting listener traffic (listener-churn)
   * spies on `addEventListener` and would count the harness's own catcher as the tier's.
   */
  const previous = view.onerror;
  view.onerror = (message, source, line, column, error) => {
    reported ??= error ?? new Error(String(message));
    return true;
  };
  try {
    entry.holder.append(made);
  } finally {
    view.onerror = previous;
  }
  if (reported !== undefined) {
    entry.hosts.delete(container);
    made.remove();
    throw reported;
  }
};
const tierFacade = async (name, mod) => {
  tierModule ??= await import(distUrl(tier));
  const { html, svg, mathml, define, signal } = tierModule;
  if (name === 'core') return facade(mod, 'core', { html, svg, mathml, define, ...(signal ? { signal } : {}), wire: () => {} });
  /** `renderer` is a dual (`renderer({ foreignNodes })`): wiring it is a no-op, calling it is core's. */
  const renderer = Object.assign(coreOnly('renderer', 'renderer(options)'), { tier });
  return facade(mod, 'renderer', { renderer, renderInto: tierRenderInto });
};
/** Core's own modules: under a tier every function they export is core's, so each throws `core-only` when called. */
const CORE_ONLY = /^(?:renderer\/|store)/;

export const load = async (name, query = '') => {
  const mod = await import(distUrl(name, query));
  if (tier === undefined || query !== '') return mod;
  if (name === 'core' || name === 'renderer') return tierFacade(name, mod);
  /** `renderer/tag`'s `html`/`svg` are the ordinary tags (plus tag VALUES, core's): under a tier, the tier's own tags. */
  if (name === 'renderer/tag') {
    tierModule ??= await import(distUrl(tier));
    return facade(mod, name, { html: tierModule.html, svg: tierModule.svg });
  }
  return CORE_ONLY.test(name) ? facade(mod, name, {}) : mod;
};
