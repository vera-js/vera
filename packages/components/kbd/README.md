# @vera-components/kbd

`<vera-kbd>` shows a keyboard shortcut the way the reader's platform spells it: `keys="Mod+Shift+K"` is ⇧⌘K on Apple
devices and Ctrl+Shift+K elsewhere, as nested `<kbd>` elements, with each symbol's word given to assistive technology.
Private until launch.

<!-- recipe -->
```js
import { wire } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import '@vera-components/kbd';

wire([renderer]);
document.body.innerHTML = '<p>Search with <vera-kbd keys="Mod+K"></vera-kbd>.</p>';
```

A key with no `Mod` in it needs no element: write `<kbd>Esc</kbd>`.

## Keys

`keys` is `+`-separated names, in any case:

- **Modifiers:** `Mod` (Command on Apple, Ctrl elsewhere), `Ctrl`, `Alt`, `Shift`, `Meta`, and the aliases `Cmd` and
  `Command` (Meta), `Option` (Alt) and `Control` (Ctrl). They are shown in one order whatever order you write them in:
  Control, Option, Shift, Command, which is Apple's (⇧⌘Z) and the usual order elsewhere (Ctrl+Shift+Z).
- **Named keys:** `Enter`, `Escape`, `Tab`, `Space`, `Backspace`, `Delete`, `ArrowUp`, `ArrowDown`, `ArrowLeft`,
  `ArrowRight`, `Home`, `End`, `PageUp`, `PageDown`, the function keys, and `Plus` for the + key itself.
- **Anything else** is shown as written, one key; a single letter as its capital.

`Meta` is Command on Apple, Win on Windows and Meta elsewhere (Linux calls it Super, ChromeOS Search).

## Platform

The reader's platform is read when the element renders. `platform="apple"`, `"windows"` or `"other"` forces one, for
a page that shows both spellings.

**On the server**, the reader's platform is unknown and Apple's symbols would need a style rule before any script runs,
so a server always renders the word spelling (`platform="windows"` keeps Win). On an Apple device the client re-spells
it once, when the element connects.

## What is spoken, and what is copied

A symbol is shown as `aria-hidden` text, and its word is spoken from CSS: the element adopts one rule into the root it
renders in, so this works whether or not the app wired `@verajs/styles`. Copying ⇧⌘K copies exactly "⇧⌘K".

A page whose own styles remove that rule (`content: none` on `[data-vera-word]::before`, or a stylesheet that drops
component styles) leaves Apple's symbols silent. Words on other platforms need no rule.

## Spelling without the element

`@vera-components/kbd/element` exports the two functions the element renders from, for a caller holding only a string
(a `title`, a toast, a command palette's own row):

<!-- recipe -->
```js
import { platformOf, spellKeys } from '@vera-components/kbd/element';

const join = (platform) => spellKeys('Mod+Shift+K', platform).map((key) => key.text).join(platform === 'apple' ? '' : '+');
join('apple'); // '⇧⌘K'
join('windows'); // 'Ctrl+Shift+K'
join(platformOf(navigator)); // the reader's
```

Each key is `{ text, word }`: `word` is what to say for a symbol, and `null` when `text` is already a word.
