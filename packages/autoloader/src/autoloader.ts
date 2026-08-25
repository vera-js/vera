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
 * @return `autoload` — call it with nothing to scan the page, with an element to watch that
 * component, or with a shadow root to watch that root. Safe to call repeatedly; a root is attached
 * once. Carries `url(tag)` and `retry(element)`.
 */
export const autoloader = (
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
  /**
   * A **relative** `rootDir` throws either way; development says why.
   *
   * The platform's own message — `Failed to construct 'URL': Invalid base URL` — names neither the
   * argument nor the fix. The value has to be absolute because every component URL resolves against
   * it, which is why `import.meta.url` is the documented answer. Behind `__DEV__`, so the build
   * folds it away and a production bundle carries neither the check nor the text.
   */
  if (__DEV__) {
    try {
      new URL('.', rootDir);
    } catch {
      throw new Error(
        `autoloader: rootDir must be an absolute URL, and "${rootDir}" is not. ` +
          `Pass import.meta.url — a relative path has nothing to resolve against.`
      );
    }
  }
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
   * Roots under observation, so attaching is idempotent and cheap to re-attempt.
   *
   * Nothing prunes it, and nothing needs to: an observed node is collectable as soon as the page
   * drops it — measured in Chromium, where a removed node observed by a live observer is collected.
   * (jsdom reports otherwise, and reports it even after `disconnect()`, which is its own
   * bookkeeping rather than the observer contract.)
   */
  const watched = new WeakSet<Element | ShadowRoot>();

  /**
   * Creates the expected element url location to be appended to the root dir.
   *
   * The per-element override attribute is `autoload-dir` — NOT `dir`, which is HTML's global
   * text-direction attribute (`dir="rtl"` on any i18n page would have silently redirected
   * component loading).
   *
   * Exposed as `autoload.url(tag)`, which is the whole of what a `preload` helper used to wrap:
   * with the URL in hand a caller can warm it with `<link rel="modulepreload">`, prefetch it at a
   * lower priority, prime a service worker, or simply print it to answer "why is it fetching
   * *that*?" — the question this module gets asked most.
   *
   * @param tag The element's name
   * @param element The element being discovered, when there is one — only it can carry `autoload-dir`
   * @return The absolute URL this autoloader would fetch
   */
  const url = (tag: string, element?: Element) => {
    /**
     * Trailing slashes come off, and an empty or root-only directory becomes `.` — the entry file's
     * own directory, which is the only place a bounded URL can be anyway.
     *
     * The default used to be `/`, which built `//tag.js`: a **protocol-relative** URL, so
     * `new URL` read `tag.js` as a *host*. `autoloader(import.meta.url)` — the documented call
     * for components sitting beside the entry, since `componentsDir` is optional — therefore
     * refused every component it was asked for. `autoload-dir="/"` did the same.
     */
    const dir = (element?.getAttribute('autoload-dir') ?? componentsDir ?? '.').replace(/\/+$/, '') || '.';
    const href = new URL(resolve ? resolve(tag, dir) : `${dir}/${tag}${extension}`, rootDir).href;
    /**
     * **Containment belongs here, not only at the fetch.**
     *
     * `autoload-dir` is an ordinary HTML attribute, so on any page whose markup is partly authored
     * elsewhere — a CMS, a sanitizer that keeps attributes, a template someone else fills — it is
     * an input. `autoload-dir="//evil.test"` resolves to a different **origin** entirely, and
     * `..` walks out of the app.
     *
     * `load` always checked. This function is public and documented for preloading — warming a URL
     * with `<link rel="modulepreload">` is its whole reason to exist — so returning a URL the loader
     * would refuse handed the caller the fetch this module declines to make. One check, at the one
     * place URLs are built, also covers a custom `resolve` returning something unbounded.
     *
     * `base` is `new URL('.', rootDir)`, which always ends in `/`, so the prefix test cannot be
     * satisfied by a sibling directory whose name merely starts the same way.
     */
    if (!href.startsWith(base)) {
      /**
       * The refused URL rides on the error, so discovery can dedupe on it exactly as it dedupes a
       * fetch. Keying the refusal on the *tag* instead would be wrong: `autoload-dir` is watched
       * precisely so it can be pointed somewhere else after a first attempt failed, and a tag
       * marked spent never looks again.
       */
      const refusal = new Error(`autoloader: refused ${href} for <${tag}> — resolves outside ${base}`);
      (refusal as Error & { href: string }).href = href;
      throw refusal;
    }
    return href;
  };

  /**
   * Loads an element's module and, once it has upgraded, starts watching it in turn.
   *
   * @param element The element to load
   * @param tag The tag to build the expected url from
   */
  const load = async (element: Element, tag: string): Promise<void> => {
    if (requested.has(tag)) return;
    let src;
    try {
      src = url(tag, element);
    } catch (error) {
      /**
       * Deduped on the refused URL, so it is reported once rather than on every scan — and so
       * pointing `autoload-dir` at a valid directory afterwards is a different URL and tries.
       */
      const href = (error as Error & { href?: string }).href;
      if (href !== undefined) {
        if (attempted.has(href)) return;
        attempted.add(href);
      }
      console.error((error as Error).message);
      return;
    }
    if (attempted.has(src)) return;
    attempted.add(src);
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
          detail: { tag, src, error, element },
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
  /**
   * Created on first use, not at construction.
   *
   * `new MutationObserver(...)` in the constructor made `autoloader` throw in Node —
   * `MutationObserver is not defined` — so an app entry that wires the autoloader could not be
   * imported server-side at all. `@verajs/router` attaches its window listeners lazily for exactly
   * this reason and says so; the observed-discovery rewrite reintroduced the problem here.
   */
  let observer;
  const observing = () =>
    (observer ??= new MutationObserver((records) => {
    for (const record of records) {
      /**
       * The three attributes are as much a part of discovery as insertion is. `autoloader` can be
       * put on a component that only becomes a lazy host once some state flips; `autoload-dir` can
       * be pointed somewhere else after a first attempt failed; `autoload-ignore` can be lifted.
       * Without watching them, all three needed the element to be inserted again before anything
       * noticed, which is not a thing that happens.
       */
      if (record.type === 'attributes') {
        const target = record.target as Element;
        if (record.attributeName === 'autoloader') watch(target);
        else consider(target);
        continue;
      }

      const added = record.addedNodes;
      for (let i = 0; i < added.length; i++) {
        const node = added[i];
        if (node.nodeType !== 1) continue;
        const element = node as Element;
        if (!customElements.get(element.localName) && element.localName.includes('-')) consider(element);
        scan(element);
      }
    }
    }));

  /**
   * Starts watching a component, and takes stock of what is already inside it.
   *
   * This is what the `'render'` insert calls, so it runs on every render of every component and has
   * to be cheap when there is nothing to do: an attribute read, then a `WeakSet` check. The scan
   * happens once, when the observation starts — everything after that arrives as a mutation.
   *
   * @param element The element to watch for undefined custom elements within
   */
  const watch = (target: Element | ShadowRoot | Document = document) => {
    /**
     * `autoload()` with nothing to point at means "every marked host on the page, right now".
     *
     * This used to happen by itself as the autoloader was created, which was wrong twice over: it
     * fired once, so markup arriving later — fetched, stamped from a template — was never seen and
     * said nothing about it; and two autoloaders on a page each adopted every marked host and raced
     * to load the same tags from their own directories, which needed an option to switch off. As a
     * shape of a function that already exists it costs almost nothing, can be called again whenever
     * new markup lands, and leaves `autoloader` free of side effects.
     *
     * A document is recognised by `nodeType`, not by having a `body`. `document.body` is null until
     * the parser reaches it, so an `autoload()` from a classic or `async` module script in `<head>`
     * fell straight through this branch and the document was treated as a root to watch — observing
     * `document` itself, `subtree: true`. That is precisely the shape this module exists to avoid
     * (~47% on every mutation in the app, measured), it was permanent once `watched` held the
     * document, and nothing said it had happened. `nodeType` is 9 from the moment the document is.
     */
    if ((target as Document).nodeType === 9)
      return (target as Document).querySelectorAll('[autoloader]').forEach((el) => watch(el));
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
    if (watched.has(root)) return;
    watched.add(root);
    observing().observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['autoloader', 'autoload-dir', 'autoload-ignore'],
    });
    scan(root);
  };

  /**
   * Markup that was in the HTML file all along belongs to nobody's render, so nothing would ever
   * have offered it up. Swept once, as soon as there is a document to sweep — which is the whole
   * point of a buildless framework working from a pasted HTML file.
   */
  /**
   * Forgets that this element's tag failed, and tries it again.
   *
   * A failed load is otherwise permanent for the page — right for a component that does not exist,
   * wrong for one lost to a dropped connection. `vera:autoload-error` hands you the element, which
   * is what makes retrying one thing rather than re-scanning every watched root possible.
   */
  const retry = (element: Element) => {
    const tag = element.localName;
    requested.delete(tag);
    const src = failed.get(tag);
    if (src) attempted.delete(src);
    failed.delete(tag);
    load(element, tag);
  };

  /**
   * The instance is also its own `wire` descriptor, so configuring the autoloader and installing it
   * are one call:
   *
   * ```js
   * wire([renderer, router, autoloader(import.meta.url, 'components')]);
   * ```
   *
   * This replaced `setAutoloader`, a bespoke registrar that lived in `@verajs/inserts` — the
   * registry package knowing about one specific consumer, which is the coupling `wire` exists to
   * remove. Every other module hands `wire` a descriptor; this one now does too.
   *
   * Priority 75 runs it *after* the renderer at 50, because it scans what the render just produced.
   */
  /**
   * `name` goes through `defineProperty` because a function's own `name` is non-writable, so
   * `Object.assign` throws in strict mode — and the descriptor's `name` is what the duplicate-
   * priority warning quotes, so leaving it as `"watch"` would name the wrong thing.
   */
  Object.defineProperty(watch, 'name', { value: '@verajs/autoloader', configurable: true });
  return Object.assign(watch, {
    url,
    retry,
    on: 'render' as const,
    fn: ((_: unknown, container: Element | ShadowRoot | Document) => {
      watch(container);
    }) as never,
    priority: 75,
  });
};
