/**
 * **`@verajs/static`**: `@verajs/core`'s `define` and `html` (with `svg` and `mathml`) for static sites, rendered once
 * into markup with no reactivity — and no value ever becomes code. A component written for it runs on `@verajs/lite` or
 * `@verajs/core` (change the import); behavior comes from `@verajs/directives`, or from moving up.
 */
export type * from './types.js';
export { define } from './define.js';
export { html, mathml, svg } from './tags.js';
