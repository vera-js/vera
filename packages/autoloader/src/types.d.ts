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

};

/**
 * What {@link initAutoloader} returns: one function with three shapes — no argument scans the page,
 * an element watches that component, a shadow root watches that root — carrying the two operations
 * that only make sense against a particular autoloader's directories and memo.
 */
export type AutoloaderInstance = ((target?: Element | ShadowRoot | Document) => void) & {
  /**
   * The instance is its own `wire` descriptor — `wire([domRender, initAutoloader(…)])` — so
   * configuring it and installing it are one call. `wire` tests for `on` before it tests for a
   * function, which is what lets a module be both.
   */
  name: string;
  on: 'render';
  fn: never;
  priority: number;
  /** The absolute URL this autoloader would fetch for a tag — warm it, prefetch it, or print it. */
  url: (tag: string, element?: Element) => string;
  /** Forget that this element's tag failed, and try it again. */
  retry: (element: Element) => void;
};
