/** **@vera-components/icon's diagnostics: DEVELOPMENT ONLY prose.** */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  /** The subject (the tag) is printed by `diagnostic` before the message, so the message never repeats it. */
  'defined-twice': () => [
    'is already defined by another copy or version of @vera-components/icon, so the first is kept.',
    'Align the versions, or import @vera-components/icon/element and define it under your own tag.',
  ],
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
