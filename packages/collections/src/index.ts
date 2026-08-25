/**
 * `@verajs/collections` — reactive `Map` and `Set` inside VeraJS stores.
 *
 * Wire it once, at your app entry, alongside the renderer:
 *
 * ```js
 * import { wire } from '@verajs/core';
 * import { renderer } from '@verajs/renderer';
 * import { collections } from '@verajs/collections';
 *
 * wire([renderer, collections]);
 * ```
 *
 * **Take `wire` from `@verajs/core`, never from `@verajs/inserts`.** A production `.min.js`
 * inlines its dependencies, so every bundle carries its own registry; registering through your own
 * copy writes where core never looks — working in development and silently doing nothing in
 * production. Core's own function writes to the map core reads, in every build.
 *
 * It lives outside core because most stores hold plain objects, and before the split every app
 * carried 367 B gzipped for collections it never created. Nothing is silent if you forget: core
 * raises a `__DEV__` error naming this package the first time a `Map` or `Set` reaches a store
 * with nothing registered.
 */
import { collectionMethod } from './collections.js';

/**
 * The descriptor to hand `wire`. Priority 50 is the convention for a default implementation —
 * register below 50 to run first, or at 50 to replace this entirely.
 */
export const collections = {
  name: '@verajs/collections',
  on: 'collection' as const,
  fn: collectionMethod,
  priority: 50,
};

export { collectionMethod, GLOBAL } from './collections.js';
