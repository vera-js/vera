import type { ComponentDemo } from '@verajs/shared-types';

/**
 * **<vera-kbd>'s states, as the preview page shows them** (`ComponentDemo`: the page is generated from this, and
 * `tests/component-demos.test.mjs` holds it to the surface).
 */
export const kbdDemo = {
  ask: "Do shortcuts read naturally in each platform's spelling? Apple's is ⇧⌘K with no separators, elsewhere Ctrl+Shift+K. Copying a shortcut copies exactly what is shown.",
  states: [
    { title: 'Apple', markup: '<vera-kbd keys="Mod+K" platform="apple"></vera-kbd> <vera-kbd keys="Mod+Shift+P" platform="apple"></vera-kbd>' },
    { title: 'Windows', markup: '<vera-kbd keys="Mod+K" platform="windows"></vera-kbd> <vera-kbd keys="Mod+Shift+P" platform="windows"></vera-kbd>' },
    { title: "The reader's own platform", markup: '<vera-kbd keys="Alt+ArrowUp"></vera-kbd> <vera-kbd keys="Escape"></vera-kbd>' },
    {
      title: 'In running text',
      note: 'a key never makes its line taller; the trade: the keycap paints about 2px into the next line at normal line height',
      markup:
        '<p style="max-width: 22em">Search with <vera-kbd keys="Mod+K"></vera-kbd>, or press <vera-kbd keys="Shift+?"></vera-kbd> for every shortcut. Close any dialog with <vera-kbd keys="Escape"></vera-kbd> and go back with <vera-kbd keys="Alt+ArrowLeft"></vera-kbd>.</p>',
    },
    { title: 'Punctuation keys', note: 'each is spoken by name: Slash, Comma, Period', markup: '<vera-kbd keys="Mod+/"></vera-kbd> <vera-kbd keys="Mod+,"></vera-kbd> <vera-kbd keys="Mod+."></vera-kbd>' },
    {
      title: 'In right-to-left text',
      note: 'the shortcut keeps its left-to-right order; the sentence around it stays right to left',
      markup: '<p dir="rtl">לחץ <vera-kbd keys="Mod+Shift+K" platform="apple"></vera-kbd> כדי לחפש</p>',
    },
  ],
} as const satisfies ComponentDemo;
