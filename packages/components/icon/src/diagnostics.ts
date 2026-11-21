/** **@vera-components/icon's diagnostics: DEVELOPMENT ONLY prose.** */
import type { Prose } from '@verajs/shared-utils';

/**
 * This package's own codes. `defined-twice` is shared-utils' (one text for every component, one code in one
 * namespace), so it is never repeated here: two packages that each listed it would be refused by `sync-diagnostics`.
 * The subject (the tag) is printed by `diagnostic` before each message, so a message never repeats it.
 */
export const PROSE: Record<string, Prose> = {
  'icon-two-sources': () => [
    'has both a child <svg> and a src, so the child is shown and src is ignored.',
    'Keep one: the child <svg>, or src.',
  ],
  'icon-scheme': () => [
    'is not rendered: only a relative URL or http(s) on this page\'s own origin is allowed.',
    'Serve the sprite from your own origin, or inline the <svg> as a child.',
  ],
  'icon-cross-origin': () => [
    'is on another origin, and the platform renders <use> only from the page\'s own origin, so nothing would show.',
    'Serve the sprite from your own origin, or inline the <svg> as a child.',
  ],
};
