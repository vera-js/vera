/**
 * The classes and their surfaces, with **no registration side effects** — for consumers who must
 * control registration themselves: two library versions on one page, scoped-registry setups, or
 * defining under their own tag names. The normal entry (`@vera-components/select`) imports this and registers.
 */
export { VeraSelect } from './select/element.js';
export type { SelectOption } from '@vera-hooks/listbox';

/**
 * The surface declarations (`src/x/surface.ts`) are deliberately NOT exported: they are
 * documentation-as-data for the manifest generator, the docs and the drift tests, and exporting
 * one from a runtime entry ships a kilobyte of prose in every bundle. Consumers read
 * `custom-elements.json`. (Measured before the split: vera-select.min.js carried the whole object.)
 */
