import type { SsrRegistry } from './types.js';

/**
 * The custom-element registry: the definitions this process has seen.
 *
 * Filled as component modules execute, since `customElements.define` is how a component announces
 * itself, and read by the nested-component scan to decide whether a tag in emitted markup is
 * something to render or something to leave alone.
 */

export const registry: SsrRegistry = new Map();
/**
 * The element classes code may construct directly, as in a browser (`new.target` exactly): every class `define`
 * accepted, and the two legacy factories `Image` and `Audio`. Anything else is an `Illegal constructor`.
 */
export const constructible = new WeakSet<object>();
