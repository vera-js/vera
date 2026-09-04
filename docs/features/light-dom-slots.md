# Light-DOM slots

## The claim

**One version of every component.** A component writes `<slot name="title">` once and it works
whether it renders into a shadow root or straight into the light DOM — and its users write
`<div slot="title">` the same way for both. The assignment follows the platform's own algorithm,
because the platform is the specification this is held to.

Light DOM matters for the things a shadow boundary is bad at: page CSS and Tailwind reach the
content, `aria-labelledby` and `for` cross freely, and a form sees the fields. Until now, choosing
that meant giving up `<slot>` entirely.

## Why it is credible

`<slot>` is meaningless outside a shadow root, so this is real distribution: at each `<slot>`
position the component's own children are moved into place, and the `<slot>` element itself never
reaches the light DOM. There is no wrapper element and no shipped stylesheet, so nothing shifts
`:nth-child` or direct-child selectors in the user's own markup.

The semantics are not approximated. **Native shadow DOM is the oracle**, in a differential test that
puts the same generated markup through a real shadow root and through light distribution and
compares what each slot ends up showing:

```sh
node --test tests/slots-native-parity-fuzz.test.mjs     # 1,000 generated cases, five seeds
```

Elements go to the slot their `slot` attribute names, everything else — text and whitespace
included — to the first unnamed slot, duplicate names give the first in tree order the content and
leave the rest showing fallback, fallback appears only while a slot is unassigned and comes back
when it empties, and capture takes the host's direct children only, so components nest.

It is live. Appending, removing or re-slotting a child redistributes, `slotchange` fires on the
slot element with the same sequence and the same `assignedNodes()` the platform produces, and
`assignedNodes()`/`assignedElements()` answer through `event.target` or an `&ref` exactly as they do
in a shadow root.

## All four corners, and the parity between them

The hard part is not the client. A component has to serialise, hydrate and re-render the same way:

```sh
node --test tests/slots-ssr-client-parity.test.mjs      # 14 shapes x 3 comparisons
```

That file asks the three questions directly. Does the SERVER produce what the CLIENT produces? Does
the server's markup ADOPT into that, without discarding it? And is a SHADOW component — one not
using the feature at all — completely untouched by the module being wired?

Server output is markerless: each `<slot>` is unwrapped to its assigned nodes or its fallback, and
the only handoff is one `data-vera-slotted="offset,count"` attribute where the default slot took
content, which hydration reads and strips. Adoption is in place, so node identity survives and with
it focus, input values and scroll position — asserted in a real browser, on three engines:

```sh
npm run test:browser:all                                # includes hydration from real server markup
```

## Cost

<!--size:slots.gzip-->2.57 KB<!--/size:slots.gzip--> gzipped, and only if you import it. The
renderer carries a small seam that records where a template's slots are; an app that never wires
this pays that and nothing else.

## The honest caveats

- **It is not unique.** Stencil does the same thing in its `scoped` mode. The difference is that
  Stencil is a compiler and this is a wired module you can leave out — but "nobody else has this"
  would be false.
- **`::slotted()` is shadow-only and is not translated.** In light DOM the content is in the same
  tree, so an ordinary descendant selector reaches it — and reaches deeper than `::slotted()` can.
  A component that renders both ways writes both. `:host` *is* translated, because a component needs
  it to style itself and nothing else can supply that.
- **A node APPENDED after the component's output must name its slot** (`slot=""` for the default
  one). The host's tail is where its own children and the component's output meet, and nothing
  distinguishes an unnamed text node from the component's there. Everywhere else — inserted before
  or among the original light content — additions are captured with native MEMBERSHIP semantics,
  attribute-less text included, so the renderer's own `${…}` re-renders and an ordinary
  `insertBefore` need nothing said. The timing trigger still applies at the tail: a parser upgrades
  an element before it has read its children, so let the definition load deferred.
- **A late insertion joins its slot at the END, where native would place it by document order.**
  Membership is native; position is not. Distribution moves nodes into the component, so by the
  time a node is inserted into the host afterwards, the siblings that would have ordered it are no
  longer beside it — and an undistributed node sits ahead of all distributed content, which reads
  as "first" for a hand-inserted node and "last" for a list's freshly created row, with nothing in
  the DOM to tell them apart. Native answers `PREPENDED, Body`; this answers `Body, PREPENDED`.
  Order the slot's content from the data instead, which is where a component's content usually
  comes from anyway. Pinned in `tests/slots-transition-parity.test.mjs`.
- **A TEXT node appended after the component's output cannot be reached at all.** The tail rule
  asks for a `slot` attribute and a text node cannot carry one, so `host.append('more')` on a
  rendered light component leaves the text beside the component rather than in its default slot
  (native puts it in the slot). Wrap it — `host.append(Object.assign(document.createElement('span'),
  { slot: '', textContent: 'more' }))` — or set the content through the template that renders the
  host. The rule cannot simply be relaxed for text: a component whose own template starts or ends
  with top-level text would then have its own output captured as slot content, which is the
  failure mode this whole rule exists to prevent. Closing it properly means giving the renderer's
  root part a closing boundary in light hosts, so the component's output ends somewhere nameable.
- **A rendered light component cannot be cloned.** `cloneNode(true)` copies its output with the
  user's nodes distributed into it; duplicate a component from its source markup instead.
- **A slotted node's `parentNode` is inside the component's tree**, not the host. That is what light
  DOM *is*, and it is exactly why page CSS reaches it.

## Seeing it

[`examples/light-slots/`](../../examples/light-slots/) — `npm run dev:slots`. Buildless, one page,
production bundles: one component rendered in both modes side by side, fallback content, the
`::slotted()` contrast above shown as two cards rather than asserted, `@slotchange` on a live
re-slot, and `<vera-select light>` with a slotted trigger.

Its neighbour [`examples/ui-select/`](../../examples/ui-select/) is the same component with the
module **not** wired, which is a supported configuration and looks exactly as this page's caveats
describe. Opening both is the fastest way to see what the wiring buys.
