# `@verajs/ui` — the select

The component library's first component, served the way a consumer gets it: production bundles
through an import map, no build step.

```sh
npm run build          # once, from the repo root — the example serves the real bundles
npm run dev:select     # then open the printed URL
```

Ten configurations of one element on one page. `@verajs/ui` and `@verajs/hooks` keep core — and each
other — external in every build, so the import map is what resolves them; that is the part worth
reading before the components.

What to look at, in order:

1. **Default** and **HTML-authored** — the same select with and without any JavaScript. The second
   is built entirely from `<option>` children, `selected` included, which seeds both the value and
   the reset default.
2. **Multi + search**, **Creatable**, **Remote** — the behaviours that are opt-in. A plain select
   has no search line; nothing here costs anything to a page that does not ask for it.
3. **Themed by token** and **Styled by `::part()`** — the two supported styling routes for a shadow
   component, in that order of preference.
4. **Light DOM** — the `light` attribute, read at connect, renders the same template into the element
   itself. No shadow root, so the parts are reachable as plain `[part='trigger']` selectors with
   nothing in the way.
5. **Your markup, slotted** — a slotted trigger and a slotted value node, distributed natively by
   the shadow root.
6. **Form-associated** — participation in a real `<form>` through `ElementInternals`.

## What this page deliberately does not wire

It never calls `wire([…, slots])`, so in the **Light DOM** section the component's four slots are
inert: they show their fallbacks, and slotted content would sit beside the component rather than
filling it. That is a real supported configuration — light mode without light slots — and it is
what this page demonstrates. (The import map does carry a `@verajs/renderer/slots` entry, because
`@verajs/ui`'s bundle keeps it external and the module graph must RESOLVE either way — mapping a
specifier and wiring a module are different acts, and this page is the demonstration that only the
second one changes behaviour.)

The other half is [`../light-slots/`](../light-slots/), which wires the module and shows the same
select in light mode *with* a slotted trigger. Wiring is page-global, which is why it is a separate
page rather than an eleventh section here.
