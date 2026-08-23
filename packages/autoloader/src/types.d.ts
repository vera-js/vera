export type AutoloaderOptions = {
  /**
   * File extension appended to the tag name when building a component's URL.
   *
   * Defaults to `.js`. Set to `.ts` so TypeScript projects can autoload their sources during
   * development — a dev server will not serve `foo.js` when only `foo.ts` exists on disk.
   * Accepted with or without the leading dot.
   */
  extension?: string;

  /**
   * Builds a tag's module URL yourself, replacing the default `dir/tag.extension`.
   *
   * `dir` is the resolved directory — the element's `autoload-dir` if it has one, otherwise the
   * `componentsDir` this autoloader was created with. The result is still resolved against the
   * entry file and still has to land inside its directory, so a custom layout cannot reach outside
   * what the default one could.
   *
   * ```js
   * initAutoloader(import.meta.url, 'components', { resolve: (tag, dir) => `${dir}/${tag}/${tag}.js` });
   * ```
   */
  resolve?: (tag: string, dir: string) => string;

  /**
   * Whether creating the autoloader sweeps the document for `[autoloader]` hosts. Defaults to
   * `true`, which is what makes hand-written markup work with nothing rendering.
   *
   * Set `false` when a page runs more than one autoloader: without it, each one adopts every marked
   * host on the page and they race to load the same tags from their own directories.
   */
  sweep?: boolean;
};

/**
 * What {@link initAutoloader} returns: the watch function, with the two operations that only make
 * sense against a particular autoloader's directories and memo.
 */
export type AutoloaderInstance = ((target: Element | ShadowRoot) => void) & {
  /** Warm a component's module ahead of time with `<link rel="modulepreload">`. */
  preload: (...tags: string[]) => void;
  /** Forget that a tag failed, and try again wherever it currently appears. */
  retry: (tag: string) => void;
};
