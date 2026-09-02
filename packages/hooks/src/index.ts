/**
 * `@verajs/hooks` — headless behavior for VeraJS components. The layered idea: element hooks
 * (`useDismiss`) sit under behavior controllers (`useSelect`), so every widget built here — or by
 * anyone else — shares one dismissal contract and one keyboard model instead of re-deriving them.
 *
 * Deliberately small surface: a name exported here is API for life. Internal helpers stay
 * internal until a second consumer proves their shape.
 */
export type * from './types.js';
export { useDismiss } from './useDismiss.js';
export { useSelect } from './useSelect.js';
export type { SelectController } from './useSelect.js';
