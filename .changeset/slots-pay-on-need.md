---
'@verajs/renderer': patch
---

Wiring light-DOM slots no longer slows down components that have no slot: only a component that needs slotting pays for it

**Performance:** once an app wired `slots`, every light-DOM custom element paid for it, slot or not: a hidden element, a
`MutationObserver`, and per-element bookkeeping for each one a template created. Measured with a fresh browser per page,
a list of plain components rendered by a template was about 9× slower to create in Firefox and Chrome. It is now
within a few percent of an app without slots. A component with neither a slot nor light content gets nothing from slots.
One with light children has them hidden from the start, as a shadow root does. A component is observed from its first
`<slot>`, decided once per template, not per element.

**Behavior:** one difference from native shadow DOM follows. A child appended by hand to a component that has neither
a slot nor light content shows until a slot renders, where a shadow root hides it. A component that expects slots says
so, and is then observed from its first render as a shadow root follows every host:

```js
init({ host: this, expectSlots: true }, setup);
wire([renderer, slots({ expectSlots: true })]); // every light component's default; its own expectSlots wins
```

`slots` stays usable bare, `wire([renderer, slots])`. Called with options, it needs a `@verajs/core` whose `wire` hands
connectors `wire` itself (this release). An older one is refused with `slots-wire-too-old` instead of wiring nothing.
