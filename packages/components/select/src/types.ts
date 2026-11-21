/**
 * The package's shared types — one `types.ts` at the import-graph root, per CODE-PRINCIPLES §1.
 */

/**
 * The shape every component's surface declaration satisfies (`src/select/surface.ts` here). It lives in
 * `@verajs/shared-types` so every component package declares against one shape, not a copy each; read its doc there.
 */
export type { ComponentSurface } from '@verajs/shared-types';
