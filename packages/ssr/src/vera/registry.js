/**
 * The custom-element registry: the definitions this process has seen.
 *
 * Filled as component modules execute, since `customElements.define` is how a component announces
 * itself, and read by the nested-component scan to decide whether a tag in emitted markup is
 * something to render or something to leave alone.
 */

export const registry = new Map();
