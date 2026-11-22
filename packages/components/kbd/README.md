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

A key with no `Mod` in it can be a plain `<kbd>Esc</kbd>`, in your own style; `<vera-kbd keys="Esc">` gives it the
keycap look below.

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

A symbol is shown as `aria-hidden` text, and its word is spoken from CSS: the element adopts its one sheet into the root it
renders in, so this works whether or not the app wired `@verajs/styles`. Copying ⇧⌘K copies exactly "⇧⌘K".

A page whose own styles remove that rule (`content: none` on `[data-vera-word]::before`, or a stylesheet that drops
component styles) leaves every symbol silent: Apple's modifiers and named keys, the arrows, and punctuation (`/` is
"Slash", `,` "Comma") on every platform. A key already shown as a word needs no rule.

## The look

Each key is a keycap: a hairline border with a heavier one below, its corners `--vera-radius` and its border
`--vera-border` (both shared tokens; without them, colors mixed from `currentColor`, so a dark page needs nothing).
Every length is in `em` (the borders keep a 1px and 2px floor, so the depth survives pixel rounding), so a key follows
the text around it at any size, and a key is an inline box, so in running
text it never pushes its line apart. The combo takes the page's font, not the browser's `monospace` for `<kbd>`; one
rule of your own brings mono keycaps back, since every rule is at zero specificity (`:where`). Forced colors keep the
border in the system's color. `data-vera-look="none"` on the element (or a key) drops the look; the words stay.
The look only reaches this element's own keys, never a plain `<kbd>` elsewhere on the page.

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
