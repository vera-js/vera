/**
 * Shared reactive state for the Svelte implementation.
 *
 * Svelte 5 drives the component from runes rather than props here, because the benchmark's contract
 * is imperative — a factory returning `create`/`append`/`swap`/… — and mutating a `$state` object
 * from outside is the direct equivalent of the `setRows` setters the React and Preact
 * implementations close over.
 */
export const store = $state({ rows: [], selected: -1 });
