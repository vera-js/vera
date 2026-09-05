# Light-DOM slots

`<slot>` without a shadow root. The same template distributes content in light DOM and in shadow
DOM, so a component is written once and the *consumer* picks the mode.

```sh
npm run build          # once, from the repo root — the example serves the real bundles
npm run dev:slots      # then open the printed URL
```

Buildless, like [`../cdn-js/`](../cdn-js/): an import map, production bundles, one inline module.
The whole demo is in `index.html` — view source is the point.

What to look at, in order:

1. **The import map.** One entry differs from any other buildless page: `@verajs/renderer/slots`.
   It is opt-in and has its own bundle, because a renderer that does not distribute light slots
   should not carry the code — a `<slot>` in a light render is otherwise inert markup.
2. **`wire([renderer, slots, styles])`.** Wired before anything renders. A template resolves the
   seam once, at construction, and is interned for the life of the page, so a component that
   rendered before the wiring keeps a slotless template forever. The renderer diagnoses that in
   development; these are production bundles, where the check is folded away.
3. **`<info-card>`, sections 2 and 3.** One class, one template, one stylesheet. The only difference
   between the two cards on the page is the argument to `init` — nothing after it renders into the
   element, a `ShadowRootInit` attaches a root. Both show the same fallback content when nothing is
   slotted.
4. **Section 4 — the thing shadow DOM cannot do.** `::slotted()` matches only the top-level assigned
   node, so a shadow stylesheet has no way to reach a *descendant* of slotted content. The light
   card styles `[slot='title'] em` and the shadow card renders the identical rule against nothing.
   This is the clearest reason to choose light mode, and the page shows both halves rather than
   asserting it.
5. **Section 5 — `@slotchange`.** Moving the badge between the footer slot and the DEFAULT slot
   tells the component, in both modes, under the platform's own event name — the counter is bound
   to the default slot, which is why the toggle crosses it. (The first version moved the badge
   between two named slots, so the assignment the counter watches never changed and the advertised
   counter sat frozen; the browser suite now clicks this button and requires the number to move.)
6. **Section 6 — `<vera-select light>`.** `@verajs/ui`'s select declares four slots; in light mode
   they are inert unless the app wires the module. This page does, so the slotted trigger is
   captured, positioned and wired with the same ARIA and handlers the built-in one gets. The page
   prints the check rather than claiming it: `slotted()` and a plain `document.querySelector` return
   the same node, because in light mode it never left the page's tree.

The same component **without** the wiring is [`../ui-select/`](../ui-select/), which is why that
page's light section slots nothing — worth opening both.

Server-rendered slots are a separate story with its own round trip: see
[`../ssr-node/`](../ssr-node/) and `docs/features/light-dom-slots.md`.
