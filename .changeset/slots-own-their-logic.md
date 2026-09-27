---
'@verajs/renderer': minor
'@verajs/inserts': patch
'@verajs/core': patch
---

Light-DOM slots live in `@verajs/renderer/slots` — an app without them no longer ships their code

**`@verajs/renderer` — breaking for custom slot strategies only.** Finding a template's `<slot>`s,
mounting them after the first update, parking them at teardown and marking the render's own output
in a light host all moved out of the renderer into `@verajs/renderer/slots`. The renderer keeps
generic points they plug into: an **instance hook** a `'template'` hook may set on a template
(`{ $c, $m, $q }` — called for every instance before its first update, after it, and at teardown,
with nothing on the hot path for templates that have none), and an optional `$o` insert hook on
the slot strategy. Slotted creation measures level with the renderer before this change on Chromium, Firefox
and WebKit. The renderer is 4.62 KB gzipped, down from 4.80; a
typical app is 7 103 B, down from 7 267. The slots module grows to 3.79 KB from 3.42, so an app
that uses slots pays about 185 B more than before (renderer and module, each gzipped) — the cost of
the contract crossing a bundle boundary, carried by the apps that use it.

- `wire([renderer, slots])` is unchanged.
- A **custom** `'slot'` strategy now wires `slotDiscovery` beside itself —
  `wire([renderer, slotDiscovery, myStrategy])` — since discovery is no longer the renderer's.
  Without it, development names the missing wiring.
- `slots` is now an array (`[slotDiscovery, strategy]`); code that read `slots.fn` or `slots.on`
  reads the second entry.
- Development warns when the slots module and the renderer come from different versions of the
  package: they are one contract across a bundle boundary.

**`@verajs/inserts` and `@verajs/core`: `wire` takes nested arrays**, so a module made of several
descriptors and connectors is itself an array and sits in an app's list like any other module. The
`Wireable` type names what `wire` accepts.
