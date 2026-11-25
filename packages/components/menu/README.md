# @vera-components/menu

`<vera-menu>`: an action menu over your own button and items. Private until launch.

**Write a button and a list of buttons.** A direct child `<button slot="trigger">` opens it; a direct child marked
`slot="menu"` holds the items: `<button>`s, `<a href>`s, `<hr>` separators, and groups (`<div role="group"
aria-label>` or `<fieldset>`). The element makes the container the platform's `popover="auto"` (top layer, light
dismiss, Escape) with `role="menu"`, the trigger its opener (`popovertarget`, `aria-haspopup`, `aria-controls`), and
each item a `menuitem` unless you wrote `menuitemcheckbox` or `menuitemradio`. It renders nothing of its own and never
moves your nodes.

<!-- recipe -->
```js
import { wire } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import { styles } from '@verajs/styles';
import '@vera-components/menu';

wire([renderer, styles]);
document.body.innerHTML = `
  <vera-menu>
    <button slot="trigger" popovertarget="actions">Actions</button>
    <div slot="menu" id="actions" popover="auto">
      <button value="rename">Rename <kbd>F2</kbd></button>
      <a href="/export">Export…</a>
      <hr>
      <button role="menuitemcheckbox" aria-checked="true" value="wrap">Word wrap</button>
      <button value="delete" aria-disabled="true">Delete</button>
    </div>
  </vera-menu>`;
```

**Before the script runs.** Serve the container with `popover="auto"` and an id, and the trigger with
`popovertarget` naming it, as above: the menu then opens, closes and light-dismisses with no script (placed where the
platform puts a popover), and its items are real buttons and links.

**Focus follows how it opened.** A key (Enter, Space, ArrowDown) or a screen reader's click focuses the first item,
ArrowUp the last; a pointer focuses the menu itself, so no item shows a focus ring until the first arrow moves to one.
The arrows, Home and End move one tab stop, and typing jumps to the next item starting with the letters. Tab closes
the menu and moves on from the trigger; Escape closes it and returns focus to the trigger.

**Open state is the platform's.** A menu's being open is a moment, not app state, so the host reflects nothing: style an
open menu with `vera-menu:has(> [slot="menu"]:popover-open)` and listen to the container's `toggle` event.

**Disabled items.** A natively `disabled` item is skipped. An `aria-disabled="true"` item stays reachable, so a reader
hears that it exists, and does nothing: prefer it for a command whose absence needs explaining.

**Choosing.** The item's own `click` is the action, so your handler on the button runs as it would anywhere. Then the
host fires `menuaction`, bubbling and cancelable, with `detail: { item, value, checked, reason }` (`value` is the item's
`value` attribute, else its text; `checked` is a checkbox or radio item's state after the choice; `reason` is
`'pointer'` or `'keyboard'`). Canceling it keeps the menu open; it cannot undo the click, which has already run. Enter
and a pointer close the menu; Space on a checkbox or radio item toggles it and keeps the menu open; an item marked
`data-keep-open` always stays. The element toggles `aria-checked` (a radio item within its group).

**Shortcuts are shown, not bound.** A `<kbd>` or `<vera-kbd>` inside an item is hidden from the item's name and, when it
reads as words (`Ctrl+Shift+K`, `F2`, or a `<vera-kbd keys="Mod+K">`), said as `aria-keyshortcuts`; a glyph such as ⌘
is not guessed. Pressing the shortcut does nothing unless your page binds it.

**Placement** is CSS anchor positioning: under the trigger at its inline start, flipping to the other side when it does
not fit, its height clamped to the viewport and scrolling. Where an engine lacks anchor positioning the menu shows where
the platform puts a popover. `data-vera-look="none"` on the host drops the look and keeps the placement.

**Context menu.** `opener="context"` opens the menu from the `contextmenu` of the direct child marked `slot="target"`
(required: the menu never takes the native menu of an element it was not given), at the pointer, with the menu focused.
From the keyboard, Shift+F10 and the ContextMenu key on the focused target open it at the target with the first item
focused, on every engine. Give the container an `aria-label`, since no trigger names it.

Submenus are not in this version. Every name is in `custom-elements.json`.

**Theming.** `<vera-menu>`'s look reads the same `--vera-*` tokens every Vera component reads (`--vera-accent`,
`--vera-radius`, `--vera-surface`, `--vera-fg` and the rest its `custom-elements.json` lists), so one `:root` block
restyles every component on the page. Dark mode follows the page: with `color-scheme: light dark` on `:root` the
defaults switch with the system, and with no `color-scheme` they are the light ones. The look's floor is the engines
with CSS `light-dark()` (Chromium 123, Firefox 120, Safari 17.5); the behavior works below it.
