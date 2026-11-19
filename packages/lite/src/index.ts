/**
 * **`@verajs/lite`**: `@verajs/core`'s `define`, `html` and `signal` for small dynamic sites, with a renderer that patches
 * values in place. Every component written for it runs unchanged on `@verajs/core` (change the import, wire a renderer).
 */
export type * from './types.js';
export { define } from './define.js';
export { signal } from './signal.js';
export { html, mathml, svg } from './tags.js';
