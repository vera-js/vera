/**
 * Reactivity primitives that `@verajs/core` deliberately does not ship.
 *
 * Every one of these extends core's *store*, and none is needed by every app — which is exactly the
 * split the module system exists to make. Import from here and a bundler tree-shakes to what you
 * used; point an import map at a subpath (`@verajs/reactivity/computed`) and a buildless page loads
 * only that one.
 *
 * The subpath entries are **additive**, unlike `@verajs/renderer`'s. Each keeps `@verajs/core`
 * external rather than inlining it, so loading two of them still leaves one core, one insert
 * registry and one store identity.
 */
export { computed } from './computed.js';
