/**
 * Where a rejection code is explained.
 *
 * **Its own module, and that is the whole reason this file exists.** The obvious home is
 * `diagnostics.ts` beside the prose, but that module is referenced only inside `__DEV__` so rollup
 * can drop it whole — and a production build DOES use this string, so importing it from there would
 * tether the entire table into every bundle and undo the 1,469 B the table was written to recover.
 *
 * **The value is permanent.** A released bundle is immutable, so every version already published
 * points here for ever: the domain cannot lapse and `/e/` cannot be reorganised without breaking
 * links in code nobody can edit any more. Every code needs a page, which is what
 * `scripts/sync-diagnostics.mjs` generates `diagnostics.json` for — it imports this constant rather
 * than restating it, so the pages and the bundles can never disagree about where they are.
 */
export const DOCS = 'https://docs.verajs.dev/e/';
