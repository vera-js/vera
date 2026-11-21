# @vera-hooks/roving-focus

`rovingFocus`: one tab stop for a group of items (a toolbar, a radio group, a tab list), moved by the arrow keys, Home
and End, the roving tabindex of the ARIA Authoring Practices. Private until launch.

```js
import { rovingFocus } from '@vera-hooks/roving-focus';

const roving = rovingFocus(toolbar, {
  items: () => [...toolbar.querySelectorAll('button')],
  orientation: 'horizontal', // or 'vertical', or 'both' (a radio group answers all four arrows)
  onMove: (item) => {},      // after an arrow, Home or End moved focus (a radio group selects here)
});
roving.focus(button); // makes it the tab stop and focuses it
roving.refresh();     // after you add or remove items while focus is elsewhere
roving.release();     // both listeners gone, every tabindex back as it was found
```

- **One tab stop.** The hook owns `tabindex` on the items while they are in the group: `0` on the active one, `-1` on
  the rest, so Tab enters the group once and the next Tab leaves it. **An item's own `tabindex` is overwritten** while
  it is in the group (one owner per attribute); it is put back when the item leaves the group, or at `release()`.
- **Keys.** Right and Left for `horizontal`, Down and Up for `vertical`, all four for `both`; Home and End go to the
  first and last reachable item. In right to left (`dir="rtl"` on the group or an ancestor) Left and Right swap; Up and
  Down never do. Direction is read at each key, so a `dir` change is followed with no observer. `wrap` (default `true`)
  continues past an end at the other. Tab, Space, Enter, and every key with Alt, Ctrl or Meta held, are left to the
  platform; a key the hook handles is `preventDefault`ed.
- **`orientation` is required**: `aria-orientation`'s default differs by role (toolbar, tablist and menubar are
  horizontal; listbox, menu and tree vertical), so the hook does not guess, and the type asks.
- **Skipped items.** By default a `:disabled` item is passed over and an `aria-disabled` one stays reachable, as the APG
  asks. Pass `skip` to choose; it is read on every key, so an item disabled later is skipped from then on.
- **Items change.** `items` is a function, read on every key and on `focusin`. Focus arriving in the group by pointer
  or by script makes that item the tab stop and gives every other item `-1`, so a natively focusable item you added
  meanwhile is never a stray stop; call `refresh()` when you change items while focus is elsewhere. When the active item
  is removed or becomes skipped, the next arrow moves to the **first** reachable item, whichever way it points.
- **Nested groups.** Each group acts only when the focused element is one of its own items, so an inner group's keys
  and focus never move the outer one. A group inside an open shadow root works (the focused element is read through the
  event's composed path).
- **Writes `tabindex` only**: never text, markup, or any other attribute.
- **Development warns** (each code is in `diagnostics.json`): a group with no reachable item has no tab stop (once,
  until one is reachable again); `focus()` on an item that is skipped or not in the group did nothing.
