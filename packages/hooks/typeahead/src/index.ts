/**
 * **@vera-hooks/typeahead**: type to jump, as the APG prescribes for a listbox or a menu. Printable characters
 * accumulate for half a second; the highlight moves to the next enabled row whose label starts with them, and one letter
 * pressed again cycles its matches. Pure: a buffer, the caller's clock and the caller's rows, no store and no DOM.
 */
export { createTypeahead } from './typeahead.js';
export type { TypeaheadRow } from './typeahead.js';
