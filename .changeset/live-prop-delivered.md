---
'@verajs/renderer': patch
'@verajs/core': patch
---

`!name` on a component is delivered: a running component re-renders when only a `!name` changed

`!name` on a custom element wrote a plain property, so a component that was already running never heard a change to it
alone: the element held the new value while its render went on showing the old one (a `.name` beside it, changing in
the same render, hid this). On a hydrated page every prop arrives after the child is running, so a `!name` never
reached it at all. It is now delivered exactly as `.name` is — template binding and `spread()` key alike — compared
against the component's current value on every render, so an equal value costs one read and renders nothing.

Also:
- During hydration, `!name` on a built-in element is recorded only for a control's user state — `value`, `checked`,
  `selected`, `open` (the same list now applies to `.open`) — and any other `!name` is written: `!indeterminate`,
  which no markup can carry, used to be dropped on adoption.
- A getter with no setter bound through `!name` is refused with one development warning, instead of a plain write that
  threw in module code.
