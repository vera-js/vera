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
position the component's own children are moved into place. A slot with content steps out of the
page and its content stands where it stood; a slot with nothing assigned stays, showing its
fallback — the same tree a reader sees composed from a shadow root. There is no wrapper element and
no shipped stylesheet, so nothing shifts `:nth-child` or direct-child selectors in the user's own
markup.

The semantics are not approximated. **Native shadow DOM is the oracle**, in a differential test that
puts the same generated markup through a real shadow root and through light distribution and
compares what each slot ends up showing:

```sh
node --test tests/slots-native-parity-fuzz.test.mjs     # 1,000 generated cases, five seeds
```

Elements go to the slot their `slot` attribute names, everything else — text and whitespace
included — to the first unnamed slot, duplicate names give the first in tree order the content and
leave the rest showing fallback — including when an earlier duplicate a re-render removed comes back
and takes its content again — fallback appears only while a slot is unassigned and comes back when it empties,
and capture takes the host's direct children only, so components nest.

That fuzz compares assignment. Whole lifecycles are compared too — re-renders, lists keyed and
unkeyed, `hold()`, late commits from async values, components inside a template, content one
template places into another component, nodes moved between hosts — in real browsers, reading the
composed tree **and element identity** after every step, so a node re-created with the same markup
counts as a difference:

```sh
npm run test:browser:all                                # includes tests/browser/slots-conformance.test.js
```

Every scenario there matches native on Chromium, Firefox and WebKit. The file keeps a list of known
divergences, empty today: an entry asserts that it still diverges, so a shape cannot quietly regress
into it, nor be fixed without the list changing.

Content a binding writes is distributed node by node, exactly as the same markup written by hand —
a keyed list whose rows name different slots, rows reordered, inserted, removed, re-slotted or
changing shape — against an oracle computed from the data alone, never read back from the DOM:

```sh
node --test tests/slots-replay-storm-fuzz.test.mjs      # every write an outer template makes, replayed
```

A slotted component is moved into place in ONE DOM operation, which core treats as a move: a Vera
component is not torn down and set up again by being slotted, just as it is not under native
slotting, where nothing moves at all (`tests/core-keep-alive.test.mjs`).

It is live. Appending, removing or re-slotting a child redistributes, `slotchange` fires on the
slot element with the same sequence and the same `assignedNodes()` the platform produces, and
`assignedNodes()`/`assignedElements()` answer through `event.target` or an `&ref` exactly as they do
in a shadow root.

## All four corners, and the parity between them

The hard part is not the client. A component has to serialize, hydrate and re-render the same way:

```sh
node --test tests/slots-ssr-client-parity.test.mjs      # 14 shapes x 3 comparisons
```

That file asks the three questions directly. Does the SERVER produce what the CLIENT produces? Does
the server's markup ADOPT into that, without discarding it? And is a SHADOW component — one not
using the feature at all — completely untouched by the module being wired?

Server output carries no wrapper elements: a `<slot>` with content is replaced by it, in place, and
one with nothing assigned is kept with its fallback — as the client keeps it. Distribution loses two facts hydration needs (which nodes are the user's,
since a component's own elements can carry `slot` too, and their order across slots), so the server
**states the light tree** rather than leaving the client to infer it. Every parent a slot filled
carries `data-vm-slotted="offset,count"`, and the host carries `data-vm-light`: for each light child
in light order, which of those ranges it went into. Two more things are present only when the markup
needs them: one inert `<template data-vm-unassigned>` holding children no slot claimed, so content
meant for a slot that only appears in another state survives the round trip instead of vanishing
from the HTML; and a `<!---->` separator where two text runs would otherwise merge in the parser.
All of it is consumed on adoption. Adoption is in place, so node identity survives and with it
focus, input values and scroll position — asserted in a real browser, on three engines.

Because the list is stated, hydration never guesses. A light component nested in another's template
adopts what the outer one placed in it, and a hydration that has to fall back keeps every light child
(named, unnamed and bare text) because the host owned its list before the walk began. A component host
**without** the statement was not rendered by the server (a template or the user created it on the
client), so it gets a client first render instead of a failed adoption that would discard its
children. `tests/hydrate-slots-conformance.test.mjs` holds hydration to a client render step by step,
with identity, across eight scenarios, and asserts that each one actually adopted:

```sh
npm run test:browser:all                                # includes hydration from real server markup
```

## Cost

<!--size:slots.gzip-->4.08 KB<!--/size:slots.gzip--> gzipped, and only if you import it. The
module carries everything slots needs — finding each `<slot>` and each host, capturing the host's
children, replaying what templates later write among them, the distribution itself — and the
renderer carries only generic hooks it plugs into (an instance hook on the template, an element's
`create`, an end-of-render call, one relocation check). An app that never wires slots pays a
comparison or a property read at those points and nothing else.

## The honest caveats

- **It is not unique.** Stencil does the same thing in its `scoped` mode. The difference is that
  Stencil is a compiler and this is a wired module you can leave out — but "nobody else has this"
  would be false.
- **`::slotted()` is shadow-only and is not translated.** In light DOM the content is in the same
  tree, so an ordinary descendant selector reaches it — and reaches deeper than `::slotted()` can.
  A component that renders both ways writes both. `:host` *is* translated, because a component needs
  it to style itself and nothing else can supply that.
- **Additions after the first render are native — membership and order, text included.** The
  renderer brackets every render, so a node written outside one is knowably yours: bare text appended to the host reaches the default slot,
  an `insertBefore` at the front precedes distributed content, and a growing list extends itself —
  each matching what a shadow root would do (`tests/slots-transition-parity.test.mjs` compares them
  directly). `slot=""`/`slot="name"` still route as before. Two notes: whitespace you append now
  suppresses the default fallback, exactly as it does in a shadow root; and re-slotting a node
  (`slot="a"` → `"b"`) puts it back in light-tree order rather than the order it arrived, so an item
  toggled into a "pinned" slot holds its place instead of jumping to the end.
- **A `<slot>` cannot sit inside table markup** — `<table><tbody><slot></slot></tbody></table>`
  does not do what it looks like, in EITHER mode. The HTML parser's table insertion mode rejects a
  `<slot>` element and foster-parents it out, so the slot and everything distributed into it end up
  before the `<table>`; a shadow root does exactly the same with the same markup, so this is the
  platform rather than this module, and the two stay in step.
  Ordinary bindings are unaffected — `<tbody>${rows}</tbody>` works, because the renderer's own
  anchor is a comment and table parsing permits comments where it rejects elements. So a table
  component takes its rows as data rather than as slotted content.
- **A node no slot takes is parked out of the page** — disconnected, where native slotting leaves it
  connected and merely unrendered. A light host has no second tree to hide it in, so a custom element
  in unassigned content runs its `disconnectedCallback` (and a Vera component its effect cleanups),
  and is set up again when a slot for it appears, identity and stores intact.
- **A `<slot>` carries `class`/`style`/`id` only while it shows its fallback**; once it has content it
  steps out of the page and its attributes go with it. Put presentation on an element around it.
- **A rendered light component cannot be cloned.** `cloneNode(true)` copies its output with the
  user's nodes distributed into it; duplicate a component from its source markup instead.
- **A slotted node's `parentNode` is inside the component's tree**, not the host. That is what light
  DOM *is*, and it is exactly why page CSS reaches it. The consequence worth knowing before you meet
  it: **`host.insertBefore(node, aChildYouGaveIt)` throws `NotFoundError`**, because that child is no
  longer a *direct* child of the host — the same line works on a shadow host, where nothing moves.
  Use `child.before(node)` / `child.after(node)`, which go through the node's current parent and are
  correct in both modes. This is also the shape of the only ordering difference left: what light has
  is fewer positions you can name, not worse ordering of the ones you can. Every position reachable
  in light DOM orders exactly as the platform does — measured across every insertion point on a
  multi-part host, not argued.

## Seeing it

[`examples/light-slots/`](../../examples/light-slots/) — `npm run dev:slots`. Buildless, one page,
production bundles: one component rendered in both modes side by side, fallback content, the
`::slotted()` contrast above shown as two cards rather than asserted, `@slotchange` on a live
re-slot, and `<vera-select light>` with a slotted trigger.

Its neighbor [`examples/ui-select/`](../../examples/ui-select/) is the same component with the
module **not** wired, which is a supported configuration and looks exactly as this page's caveats
describe. Opening both is the fastest way to see what the wiring buys.
