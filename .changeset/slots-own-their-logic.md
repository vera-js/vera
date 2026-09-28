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
and WebKit.

**What it weighs, against 0.2.2, gzipped.** The renderer is 4 767 B (0.2.2: 4 679), now carrying the
`'template'` hook `@verajs/renderer/namespaces` plugs into and the fixes below; an app that does not
use slots is 7 237 B (7 141). The slots module is 3 788 B (3 424), and a slotted light component
bundled with both is **10 497 B, up from 10 028 — about 470 B more** for the apps that use slots: the
contract now crosses a bundle boundary, and those apps carry it.

- `wire([renderer, slots])` is unchanged in what you write — but it needs `@verajs/core` 0.3.2 or
  later, whose `wire` accepts the nested array `slots` now is. An older core wires nothing from it,
  silently.
- A **custom** `'slot'` strategy now wires `slotDiscovery` beside itself —
  `wire([renderer, slotDiscovery, myStrategy])` — since discovery is no longer the renderer's.
  Without it, development names the missing wiring.
- `slots` is now an array (`[slotDiscovery, strategy]`); code that read `slots.fn` or `slots.on`
  reads the second entry.
- Development warns when the slots module and the renderer come from different versions of the
  package: they are one contract across a bundle boundary. An older slots module beside this
  renderer is treated as unwired in both builds — its fallback shows and nothing is lost.
- `slotDiscovery` sets its instance hook first (`'template'` priority 10), so a module wired after
  it finds slots' hook and wraps it; one wired before it is replaced, and development says so.

**Fixed — also in 0.2.2: with slots wired, a light component's own top-level `${…}` lost its
content on update.** `${busy ? spinner() : list()}` as a component's whole template rendered the
spinner and then an empty host; a top-level list grew to one row of three. It hit components with
no `<slot>` at all, because every light host is captured once slots is wired. A nested render during
a slotted template's first update — a ref that renders a tooltip — no longer loses the slot's content
either.

**`@verajs/inserts` and `@verajs/core`: `wire` takes nested arrays**, so a module made of several
descriptors and connectors is itself an array and sits in an app's list like any other module. The
`Wireable` type names what `wire` accepts.
