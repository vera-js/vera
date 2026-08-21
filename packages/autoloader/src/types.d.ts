export type AutoloaderOptions = {
  /**
   * File extension appended to the tag name when building a component's URL.
   *
   * Defaults to `.js`. Set to `.ts` so TypeScript projects can autoload their sources during
   * development — a dev server will not serve `foo.js` when only `foo.ts` exists on disk.
   * Accepted with or without the leading dot.
   */
  extension?: string;
};
