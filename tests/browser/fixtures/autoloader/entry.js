/**
 * Stands in for an app entry: the autoloader resolves every component URL relative to this file's
 * directory, and refuses anything that lands outside it.
 */
export const here = import.meta.url;
