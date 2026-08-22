/**
 * `@verajs/styles` — `static styles` support for VeraJS components.
 *
 * Wire it once, at your app entry, next to `setRenderer`:
 *
 * ```js
 * import { insert } from '@verajs/core';
 * import { adoptStyles } from '@verajs/styles';
 * insert('init', adoptStyles, 50);
 * ```
 *
 * **Why this is three lines rather than a bare `import '@verajs/styles'`.** A production
 * `.min.js` inlines `@verajs/inserts`, so every bundle carries its own registry. A module that
 * registered itself at import would write into *its* copy while core read *its own* — working
 * perfectly in development, where the dependency stays external and both resolve to one module,
 * and silently doing nothing in production. Taking `insert` from `@verajs/core` sidesteps the
 * question entirely: it is core's own function, writing to the map core reads, in every build.
 *
 * `@verajs/ssr` wires its server renderer exactly the same way, for exactly this reason.
 *
 * Priority 50 is the convention for a default implementation — register below 50 to run first, or
 * at 50 to replace this entirely.
 *
 * It lives outside core because most apps do not use `static styles`, and before the split every
 * app paid 300 B gzipped for one unconditional call.
 */
export type * from './types.js';
export { adoptStyles, applyStyles } from './styles.js';
