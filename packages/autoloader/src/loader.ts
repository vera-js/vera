/**
 * `directiveLoader` — the autoloader's answer on core's `'loader'` insert: a DIRECTIVE NAME
 * nobody has wired resolves by convention to one module URL, `{base}/{dir}/{name}.js`, exactly
 * as component tags resolve. The engine asks (design §7: directives DISCOVERS, autoloader
 * LOADS); this claims and imports; **the module registers itself** by importing
 * `wireDirectives` from the same specifier the page used — module caching makes that the same
 * registry, the precise symmetry of an autoloaded component calling `customElements.define`.
 *
 * ```js
 * import { wire } from '@verajs/core';
 * import { directiveLoader } from '@verajs/autoloader';
 * wire([directiveLoader(import.meta.url, 'directives')]);
 * ```
 *
 * A lazy module looks like:
 *
 * ```js
 * // directives/sparkle.js
 * import { wireDirectives } from '@verajs/directives';
 * wireDirectives({ name: 'sparkle', value: 'none', setup(el) { … } });
 * ```
 *
 * **The name is markup input** — it is the tail of an attribute an author (or a CMS, or an
 * attacker who can write attributes) chose — so it is allowlisted to the directive-name grammar
 * (`[a-z][a-z0-9-]*`) BEFORE any URL exists. That single gate closes the traversal and
 * encoded-separator families the component path has to police character by character, because a
 * tag name passes through the HTML parser and this does not. Containment against the entry's
 * directory is still enforced on the final URL, so an `alias` or `resolve` mistake cannot
 * escape either.
 *
 * The `alias` map is FACTORY-ONLY JavaScript (never markup — same rule as every policy option
 * in this codebase): it redirects names for grouped layouts, so `alias: { paint: 'motion.js',
 * split: 'motion.js' }` serves one bundle for a family. One attempt per name per page load,
 * exactly the autoloader's posture with URLs; the ASKER memoizes refusals, this memoizes loads.
 */
import type { DirectiveLoaderInstance, DirectiveLoaderOptions } from './types.js';

/** The name grammar. An attribute tail that is not a plausible directive name is declined —
 *  which also means it never becomes a URL. */
const SAFE_NAME = /^[a-z][a-z0-9-]*$/;

export const directiveLoader = (
  rootDir: string,
  directivesDir?: string,
  options?: DirectiveLoaderOptions
): DirectiveLoaderInstance => {
  if (!rootDir) throw new Error('directiveLoader: rootDir is required (usually import.meta.url)');
  if (__DEV__) {
    try {
      new URL('.', rootDir);
    } catch {
      throw new Error(
        `directiveLoader: rootDir must be an absolute URL, and "${rootDir}" is not. ` +
          `Pass import.meta.url — a relative path has nothing to resolve against.`
      );
    }
    if (options)
      for (const key of Object.keys(options))
        if (key !== 'extension' && key !== 'alias' && key !== 'resolve')
          console.warn(
            `[vera] directiveLoader: \`${key}\` is not an option, so it was ignored. ` +
              `The options are extension, alias and resolve.`
          );
  }
  const base = new URL('.', rootDir).href;
  const extension = `.${(options?.extension ?? '.js').replace(/^\./, '')}`;
  const alias = options?.alias;
  const resolve = options?.resolve;
  const dir = (directivesDir ?? '.').replace(/\/+$/, '') || '.';

  /** One import per name per page load; the promise is the memo, so N elements share one fetch. */
  const claimed = new Map<string, Promise<unknown>>();

  /**
   * The URL this loader would fetch for a name — public for the same reason the autoloader's
   * `url` is: warming with `<link rel="modulepreload">` is the whole preload story, and printing
   * it answers "why is it fetching THAT". Throws on a name outside the grammar or a resolution
   * outside the entry's directory, exactly as `load` refuses them.
   */
  const url = (name: string): string => {
    if (!SAFE_NAME.test(name)) {
      throw new Error(`directiveLoader: "${name}" is not a directive name this will resolve.`);
    }
    const target = alias?.[name] ?? (resolve ? resolve(name, dir) : `${dir}/${name}${extension}`);
    const href = new URL(target, rootDir).href;
    /**
     * Containment on the FINAL url, whichever path built it. The name grammar already forbids
     * every traversal spelling markup could carry; this is the backstop for a factory mistake —
     * an `alias` of `../../evil.js`, a `resolve` returning an absolute URL — refused rather
     * than fetched, because a loader is a thing that turns strings into same-origin module
     * execution and the entry's directory is the stated bound.
     */
    if (!href.startsWith(base)) {
      throw new Error(`directiveLoader: refused ${href} for "${name}" — resolves outside ${base}`);
    }
    return href;
  };

  const load = (name: string): boolean | Promise<unknown> => {
    if (!SAFE_NAME.test(name)) return false;
    const existing = claimed.get(name);
    if (existing) return existing;
    let src: string;
    try {
      src = url(name);
    } catch (error) {
      console.error(`[vera] ${(error as Error).message}`);
      return false;
    }
    /**
     * The import IS the claim. Success means "the module ran" — whether it registered the name
     * is the ASKER's check, because only the asker owns the registry; a module that loads and
     * registers nothing earns `loader-loaded-nothing` there, with this URL in the story via the
     * console line below.
     */
    const request = import(/* @vite-ignore */ src).catch((error) => {
      console.error(`[vera] directiveLoader: failed to load "${name}" from ${src}:`, error);
      throw error;
    });
    claimed.set(name, request);
    return request;
  };

  /** The instance is its own wire descriptor — configuring and installing are one call. */
  Object.defineProperty(load, 'name', { value: '@verajs/autoloader directiveLoader', configurable: true });
  return Object.assign(load as (name: string, element: Element) => boolean | Promise<unknown>, {
    url,
    on: 'loader' as const,
    fn: load as never,
    /** Convention answers LAST: an app's own loader (an alias shim, a manifest) registers lower. */
    priority: 75,
  });
};
