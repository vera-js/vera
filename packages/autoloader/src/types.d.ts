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
