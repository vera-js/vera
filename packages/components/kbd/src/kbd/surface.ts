import type { ComponentSurface } from '@verajs/shared-types';

/**
 * **<vera-kbd>'s declared surface: every name a consumer can depend on, as data.** `custom-elements.json` is generated
 * from it (`scripts/generate-cem.mjs`; the gate's `--check` refuses a manifest that disagrees), so a name added to
 * the element is added here in the same change, and renaming one is a breaking change. Both attributes are observed
 * (core's `define` turns them into props).
 */
export const kbdSurface = {
  tag: "vera-kbd",
  description: "Shows a keyboard shortcut in the reader's platform's spelling: keys=\"Mod+Shift+K\" renders as ⇧⌘K on Apple devices and Ctrl+Shift+K elsewhere, as nested <kbd> elements, with each symbol's word given to assistive technology.",
  attributes: [
    {
      name: 'keys',
      description:
        'The shortcut, as +-separated key names, case-insensitive: Mod (Command on Apple, Ctrl elsewhere), Ctrl, Alt, Shift, Meta, their aliases (Cmd, Command, Option, Control), named keys (Enter, Escape, Tab, Space, Backspace, Delete, the arrows, Home, End, PageUp, PageDown, the function keys, Plus for a literal +), or any other key as written. Modifiers are shown in the platform\'s order whatever order they are written in.',
    },
    {
      name: 'platform',
      description:
        'apple, windows or other, to force a spelling instead of the reader\'s. A server never renders apple\'s symbols: it renders words, and the client re-spells once.',
    },
  ],
  properties: [],
  events: [],
  methods: [],
  slots: [],
  parts: [
    { name: 'combo', description: 'The outer <kbd> holding the whole shortcut.' },
    { name: 'key', description: 'One key\'s <kbd>. A symbol key carries data-vera-word, its word, spoken and never shown.' },
  ],
  states: [],
  customStates: [],
  tokens: [],
} as const satisfies ComponentSurface;
