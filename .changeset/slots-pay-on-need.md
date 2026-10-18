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
a slot nor light content shows until a slot renders, where a shadow root hides it. A component can be observed from its first
render instead, as a shadow root follows every host — `observeSlots: 'eager'` (the default is `'lazy'`, as HTML's
`loading` pairs them; lazy is fully correct for everything a template renders):

```js
init({ host: this, observeSlots: 'eager' }, setup);
wire([renderer, slots({ observeSlots: 'eager' })]); // every light component's default; its own observeSlots wins
```

`slots` stays usable bare, `wire([renderer, slots])`. Called with options, it needs a `@verajs/core` whose `wire` hands
connectors `wire` itself (this release). An older one is refused with `slots-wire-too-old` instead of wiring nothing.

**Behavior:** a server-rendered light host that reaches the client with NO children at all — its content stripped on
the way (an HTML rewriter, an edge transform) while its `data-vm-light` statement was kept — is now rendered fresh. It
used to be refused with `hydration-unwired`. Nothing can be duplicated or lost when the host is empty, so there is
nothing for the refusal to protect.


A page that wires slots but has nothing slotted yet now pays nothing per render: slots installs its render-end hook at
the first component that needs it. Firefox creates plain components 4.4% faster on such a page, and Chrome is
unchanged within noise.

Light-DOM components whose light children all have a slot create 8–15% faster (Firefox 8%, Chrome 9%, WebKit 14%): the
hidden element that holds unassigned children is now built only when a child first has no slot to go to.
