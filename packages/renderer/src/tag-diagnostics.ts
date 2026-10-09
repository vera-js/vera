/**
 * **`@verajs/renderer/tag`'s diagnostics, keyed by code — DEVELOPMENT ONLY** (referenced behind `__DEV__`, so a
 * production bundle drops it). One table per bundle entry, so the tag entry's development bundle carries only its own
 * prose; `scripts/sync-diagnostics.mjs` merges the renderer's tables into `packages/renderer/diagnostics.json`. A tagged
 * template called as a function is core's `tag-called`, and an object `style` and a void element's children are the
 * jsx compiler's facts too (`style-object`, `void-children`) — all three raised from shared-utils' table.
 */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  'tag-position': (tag) => [
    `a tag (\`${tag}\`) may only stand in tag position — \`<\${T}>…</\${T}>\`.`,
    'Spliced anywhere else it would become text or part of an attribute, which a tag never means.',
  ],
  'tag-interpolation': () => [
    'only another tag may be interpolated — a string cannot become markup.',
    'Interpolate a tag: tag`${Base}-card`, where Base is itself a tag.',
  ],
  'tag-name': (text) => [
    `${text} is not an element name. A tag names ONE element — letters, then letters, digits, '.', '_' or '-' — and nothing else becomes markup here.`,
    'Attributes and content belong in the template: html`<${heading} class="title">…</${heading}>`.',
  ],
  'tag-key': () => [
    '`key` does nothing on a tag component and has been dropped — a key marks a template for list reconciliation, and this call returns one rather than being one.',
    'In JSX, write it and the compiler handles it: `<Row key=${id}>` becomes `keyed(id, Row({…}))`. Calling by hand, wrap it yourself: `keyed(id, Row({…}))`.',
  ],
  'tag-inner-html': () => [
    '`dangerouslySetInnerHTML` is not available on a tag component and has been dropped. A tag binds through `spread`, whose names are only known at runtime — so it refuses `.innerHTML` outright rather than open an unreviewable HTML sink.',
    "Write the element directly, with the value sanitized first: html`<${Tag} .innerHTML=${trusted}>` (see the renderer README's security note).",
  ],
};
