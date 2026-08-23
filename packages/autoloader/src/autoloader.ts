import { AutoloaderInstance, AutoloaderOptions } from './types.js';

/**
 * Inits an autoloader with the provided root directory, component directory and autoloader options.
 *
 * Discovery is **observed, not polled**. Each `autoloader`-marked component is watched once with a
 * `MutationObserver`, so an undefined element is found whenever it enters the DOM — by a render, by
 * `innerHTML`, by a third-party widget, or by having been in the HTML file all along. The previous
 * model re-scanned a marked component's whole tree on every render, which saw only what a Vera
 * render put there and cost more the larger the component got (measured in Chromium: 0.46 µs for a
 * 10-node component, 32.5 µs for a 1 000-node one, on every render, forever). An observation costs
 * ~0.6 µs per mutation batch and does not care how big the component is.
 *
 * One observer object watches every marked root — `observe()` takes many targets — and a mutation
 * only notifies observers on its own ancestor chain, so watched subtrees that are not the ones
 * changing cost nothing. Measured: 1 000 registrations left unrelated DOM work at 0.900 µs against
 * 0.933 µs with none. Watching `document` instead would have been the expensive shape, taxing every
 * mutation in the app by ~47%.
 *
 * @param rootDir The root directory of all components. Should almost always be import.meta.url unless you are using
 * absolute paths
 * @param componentsDir The relative directory from the root directory. If element has an "autoload-dir" attribute, the
 * autoloader will read from that first
 * @param options Autoloader options. `extension` sets the file extension appended to the tag name, which lets
 * TypeScript projects autoload `.ts` sources during dev (a dev server will not serve `foo.js` when only `foo.ts`
 * exists). Defaults to `.js`. `resolve` replaces URL building entirely.
 * @return A function that starts watching an element. Safe to call repeatedly — it attaches once.
 */
export const initAutoloader = (
  rootDir: string,
  componentsDir?: string,
  options?: AutoloaderOptions
): AutoloaderInstance => {
  /** A configuration error fails at the misconfiguration, not once per element per render. */
  if (!rootDir) throw new Error('autoloader: rootDir is required (usually import.meta.url)');

  /** Normalized so callers may pass either `ts` or `.ts` */
  const extension = `.${(options?.extension ?? '.js').replace(/^\./, '')}`;

  /**
   * `dir/tag.ext` is one layout, and a component library is as likely to use `tag/tag.js`,
   * `tag/index.js`, or a flat manifest. `resolve` replaces the URL-building step entirely while
   * leaving the containment check below untouched — so a custom layout cannot be used to escape
   * the entry's directory. Principle #6 names this module's hard-coded `.js` as the example of the
   * shape to avoid; the path around it is the same problem one level out.
   */
  const resolve = options?.resolve;

  /**
   * Every resolved URL must stay inside the entry's own directory. Tag names cannot carry `/`
   * (the HTML parser won't produce one), but the `autoload-dir` override is free text — and
   * CODE-PRINCIPLES #8 requires bounding anything that turns markup into a module URL. An
   * absolute, protocol-relative, or upward-traversing value resolves outside this prefix and is
   * refused.
   */
  const base = new URL('.', rootDir).href;

  /** One attempt per URL per page load, so a 404 costs one request and one console line. */
  const attempted = new Set<string>();

  /**
   * Tags already being loaded, which is a different question from URLs already fetched.
   *
   * `<x-y>` and `<x-y autoload-dir="alt">` are two URLs for one tag. Both used to import, and the
   * second module's `customElements.define('x-y')` threw `NotSupportedError` — surfacing as a
   * "Failed to load" for a component that had in fact loaded. A tag can only be defined once, so
   * the second URL could never have helped. It is released again if the first attempt fails, so a
   * second location is still allowed to try.
   */
  const requested = new Set<string>();

  /** The URL last tried for a tag, so `retry` knows which memo to clear. Dropped once it loads. */
  const failed = new Map<string, string>();

  /**
   * Roots under observation, weakly — so attaching is idempotent, and `retry` has something to
   * re-scan. A `Set` of `WeakRef`s is this repo's iterable stand-in for a `WeakSet`; the router
   * holds its router elements the same way.
   *
   * Nothing prunes it, and nothing needs to: an observed node is collectable as soon as the page
   * drops it — measured in Chromium, where a removed node observed by a live observer is collected.
   * (jsdom reports otherwise, and reports it even after `disconnect()`, which is its own
   * bookkeeping rather than the observer contract.)
   */
  const watched = new Set<WeakRef<Element | ShadowRoot>>();
  const isWatched = (root: Element | ShadowRoot) => {
    for (const ref of watched) if (ref.deref() === root) return true;
    return false;
  };

  /**
   * Creates the expected element url location to be appended to the root dir.
   *
   * The per-element override attribute is `autoload-dir` — NOT `dir`, which is HTML's global
   * text-direction attribute (`dir="rtl"` on any i18n page would have silently redirected
   * component loading).
   *
   * @param element The element the autoloader is discovering
   * @param tag The element's name
   * @return The element's expected location to be appended to the root dir
   */
  const elementURL = (element: Element, tag: string) => {
    /**
     * Trailing slashes come off, and an empty or root-only directory becomes `.` — the entry file's
     * own directory, which is the only place a bounded URL can be anyway.
     *
     * The default used to be `/`, which built `//tag.js`: a **protocol-relative** URL, so
     * `new URL` read `tag.js` as a *host*. `initAutoloader(import.meta.url)` — the documented call
     * for components sitting beside the entry, since `componentsDir` is optional — therefore
     * refused every component it was asked for. `autoload-dir="/"` did the same.
     */
    const dir = (element.getAttribute('autoload-dir') ?? componentsDir ?? '.').replace(/\/+$/, '') || '.';
    return resolve ? resolve(tag, dir) : `${dir}/${tag}${extension}`;
  };

  /**
   * Loads an element's module and, once it has upgraded, starts watching it in turn.
   *
   * @param element The element to load
   * @param tag The tag to build the expected url from
   */
  const load = async (element: Element, tag: string): Promise<void> => {
    if (requested.has(tag)) return;
    const src = new URL(elementURL(element, tag), rootDir).href;
    if (attempted.has(src)) return;
    attempted.add(src);

    if (!src.startsWith(base)) {
      console.error(`autoloader: refused ${src} for <${tag}> — resolves outside ${base}`);
      return;
    }
    requested.add(tag);
    failed.set(tag, src);

    try {
      await import(/* @vite-ignore */ src);
      await customElements.whenDefined(tag);
      failed.delete(tag);
      watch(element);
    } catch (error) {
      requested.delete(tag);
      /**
       * Reported as a DOM event as well as a console line, because a component that never arrives
       * is something an app may want to render around — a placeholder, a retry button, a report to
       * an error tracker. An event rather than core's `'error'` insert: this package deliberately
       * does not depend on core, and reaching for `insert` from `@verajs/inserts` instead would
       * write to a registry core never reads in a production build.
       */
      element.dispatchEvent(
        new CustomEvent('vera:autoload-error', {
          bubbles: true,
          composed: true,
          detail: { tag, src, error },
        })
      );
      console.error(`Failed to load custom element ${tag} from ${src}:`, error);
    }
  };

  /** Loads one candidate, unless it has opted out. */
  const consider = (element: Element) => {
    if (element.getAttribute('autoload-ignore') == null) load(element, element.localName);
  };

  /**
   * `:not(:defined)` already means "a custom element awaiting its definition" — a dashless unknown
   * tag like `<madeupelement>` is defined, and an element leaves the set the moment its definition
   * lands. `tests/browser/autoloader.test.js` pins those semantics in a real engine, which is what
   * lets this trust the selector rather than re-checking the tag by hand.
   */
  const scan = (root: Element | ShadowRoot) => {
    const elements = root.querySelectorAll(':not(:defined)');
    for (let i = 0; i < elements.length; i++) consider(elements[i]);
  };

  /**
   * One observer for every watched root. A node added anywhere inside one is examined itself and
   * then scanned, because a subtree may arrive whole — `innerHTML` on a container delivers one
   * added node holding any number of undefined elements.
   */
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const added = record.addedNodes;
      for (let i = 0; i < added.length; i++) {
        const node = added[i];
        if (node.nodeType !== 1) continue;
        const element = node as Element;
        if (!customElements.get(element.localName) && element.localName.includes('-')) consider(element);
        scan(element);
      }
    }
  });

  /**
   * Starts watching a component, and takes stock of what is already inside it.
   *
   * This is what the `'render'` insert calls, so it runs on every render of every component and has
   * to be cheap when there is nothing to do: an attribute read, then a `WeakSet` check. The scan
   * happens once, when the observation starts — everything after that arrives as a mutation.
   *
   * @param element The element to watch for undefined custom elements within
   */
  const watch = (target: Element | ShadowRoot) => {
    let root = target as Element | ShadowRoot;
    /**
     * An `Element` has to opt in; a `ShadowRoot` handed over directly does not, because handing it
     * over *is* the opt-in. That is the way into a third-party component whose shadow root holds
     * tags of yours — nothing else can reach it, since an observer cannot cross a shadow boundary.
     */
    if ((target as Element).getAttribute) {
      const element = target as Element;
      if (element.getAttribute('autoloader') == null) return;
      if (element.getAttribute('autoload-ignore') != null) return;
      root = element.shadowRoot ?? element;
    }
    if (isWatched(root)) return;
    watched.add(new WeakRef(root));
    observer.observe(root, { childList: true, subtree: true });
    scan(root);
  };

  /**
   * Markup that was in the HTML file all along belongs to nobody's render, so nothing would ever
   * have offered it up. Swept once, as soon as there is a document to sweep — which is the whole
   * point of a buildless framework working from a pasted HTML file.
   */
  const sweep = () => document.querySelectorAll('[autoloader]').forEach(watch);
  if (options?.sweep !== false) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sweep, { once: true });
    else sweep();
  }

  /**
   * Fetches and compiles a component's module without running it, for one you know is coming — a
   * route's shell, something below the fold. `modulepreload` is the platform's own answer, and it
   * warms the same URL the loader will ask for, so the later `import()` is a cache hit.
   *
   * Bounded exactly as a load is: a tag that resolves outside the entry's directory is refused.
   */
  const preload = (...tags: string[]) => {
    for (const tag of tags) {
      const dir = (componentsDir ?? '.').replace(/\/+$/, '') || '.';
      const src = new URL(resolve ? resolve(tag, dir) : `${dir}/${tag}${extension}`, rootDir).href;
      if (!src.startsWith(base)) {
        console.error(`autoloader: refused ${src} for <${tag}> — resolves outside ${base}`);
        continue;
      }
      const link = document.createElement('link');
      link.rel = 'modulepreload';
      link.href = src;
      document.head.appendChild(link);
    }
  };

  /**
   * Forgets that a tag failed and tries again wherever it currently appears.
   *
   * A failed load is otherwise permanent for the page, which is right for a component that does not
   * exist and wrong for one lost to a dropped connection. Pair it with `vera:autoload-error`, which
   * hands you the tag.
   */
  const retry = (tag: string) => {
    requested.delete(tag);
    const src = failed.get(tag);
    if (src) attempted.delete(src);
    failed.delete(tag);
    for (const ref of watched) {
      const root = ref.deref();
      if (root) scan(root);
      else watched.delete(ref);
    }
  };

  return Object.assign(watch, { preload, retry });
};
