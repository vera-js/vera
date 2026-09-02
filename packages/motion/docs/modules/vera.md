# `@verajs/motion/vera`

**How a Vera app animates elements inside its components, including closed shadow roots nested
arbitrarily deep.** Written against `vera-js/vera` as of 2026-08-31; every claim about Vera's API
below was read out of its source, and the file and line are named so a reader can check.

---

## The problem, stated exactly

`querySelectorAll` does not pierce a shadow boundary, and a `MutationObserver` does not either —
`subtree: true` on a host reports **nothing** from inside its shadow tree, verified in Chromium,
WebKit and Firefox. So every shadow root has to be registered with `motion.observe(root)`.

For an **open** root a page could in principle find them by walking and reading `element.shadowRoot`.
For a **closed** one it cannot: `element.shadowRoot` is `null` from outside, which is what closed
means. No selector, no `TreeWalker`, no `XPath` and no observer will ever reach one — `document.evaluate`
with a `ShadowRoot` as context node throws `NotSupportedError` in all three engines.

**So the root has to come from whoever created it.** That is not a limitation to engineer around; it
is the definition of the feature.

## Vera already holds them

Three pieces of Vera's current API do the whole job.

| what | where | why it matters |
|---|---|---|
| `element._root` | `packages/core/src/modules/init.ts` | The root the component renders into, **kept precisely because `element.shadowRoot` is null for a closed one**. Its own docblock in `packages/core/src/types.d.ts` calls it "a cross-boundary contract like `_hooks` [that] must never be mangled". |
| the `'init'` insert | `packages/core/src/modules/init.ts` — `initInserts?.forEach(cb => cb(element))` | `InitInsert = (element: HTMLElement) => void`. Called with **every component element** as it initialises, at every depth. This is the handover. |
| `element._cleanups` | `packages/core/src/modules/init.ts` | A `Set`, drained on `disconnectedCallback` — Vera patches `customElements.define` to wire that. This is the matching `unobserve`. |

And `wire({ on, fn, priority })` is the registration API, which is the same shape as this library's
own `wireMotion`. **Take `wire` from `@verajs/core`, never from `@verajs/inserts`** — a production
bundle inlines the registry, so registering through your own copy writes to a map core never
reads. It works in development and silently does nothing in production.

## The integration

```js
import { wire } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import { autoloader } from '@verajs/autoloader';
import { motion } from '@verajs/motion/vera';

wire([renderer, autoloader, motion]);
```

One name in the list, like every other Vera module. It creates its own instance, starts it as
`wire()` registers it, and needs nothing else said. Every component then registers its own root on
mount and gives it back on unmount, at every depth, open or closed.

**Call it to configure**: `motion({ inertia: 0.3 })`, or `motion(options, priority)` to move it in
the `'init'` chain — it defaults to 60, after the renderer's 50. That a module can be **both a
function and a descriptor** is Vera's own allowance, and `@verajs/autoloader` uses it for the same
reason: configuring it and registering it are one call. This library makes the same allowance —
`wireMotion(sequence)` against `wireMotion(sequence({ allowedOrigins }))`.

`motion.instance` is the runtime instance once wired, for a page that wants `rejected`, `disable()`
or `refresh()`. It is `null` before `wire()` has run, because nothing exists before then.

**Wire it before the components that use it.** `fn` is called for each component as it initialises,
so one that upgraded earlier was never handed over — and if its root is closed, nothing can find it
afterwards.

**306 bytes gzipped, and it imports nothing from Vera.** `_root`, `_cleanups` and the descriptor
shape are all read structurally, so this artifact carries no dependency on the framework's version,
its build or its types. It imports `createMotion` from the runtime and **that import stays
external** — `dist/vera.js` references `@verajs/motion` rather than inlining a second copy of it,
which is the shared-chunk problem from the other direction. A page that is not a Vera app never
imports this module and pays nothing for it.

It registers no attributes, which is why it has no section in
[the attribute reference](../ATTRIBUTE-REFERENCE.md): it is an integration, not a property module.

**One thing here is inferred rather than verified:** that the `'init'` insert runs before the
renderer has drawn. Priorities say so — the renderer registers at 50 — but this has not been
measured. It does not break anything either way: a root registered before its content exists is
adopted empty, and the per-root `MutationObserver` picks the content up as it renders. It does mean
the batch below may run twice rather than once on first paint, which is worth confirming.

## What this library does with them

- **One `MutationObserver` per root.** A shared one has no per-target unobserve, so giving up a root
  would cost a disconnect and a re-observe of every other — O(roots) on a call a component makes on
  unmount.
- **Adoption is synchronous; painting is batched to a microtask.** Adopting a root reads geometry
  and painting one writes style, so doing both in each call made the next call's read force a full
  layout. `instance.elements` is right the moment `observe()` returns; what lands a microtask later
  is `will-change`, `transform-origin`, `offset-path`, the `position: sticky` a `pin` writes, and
  the first value. A microtask runs before paint, so nothing is ever visible un-animated.
- **One instance, many roots.** Elements from every root land in one list, so there is one frame
  pass, one `IntersectionObserver` and one scroll listener for the whole page — *not* one per
  component. Giving each component its own `createMotion` would multiply all of those.
- **A root whose host leaves is dropped** on the next `collect()`, so a component that forgets to
  `unobserve` leaks nothing permanent. Vera does not forget: `_cleanups` runs on disconnect.

Measured, 400 components each with one closed root, against 400 of the same elements in one tree:

```
                  before      now     one tree
mount             779 ms     9.5 ms     5.0 ms
unmount           478 ms     4.6 ms        —
```

`spikes/roots-cost.mjs` holds it and fails if it stops being linear.

## What works across the boundary already

`spikes/geometry.mjs`, all three engines, the `offsetParent` walk against `getBoundingClientRect`:

```
shadow closed             walk 820   rect 820   delta 0   div > div > body
shadow nested (2 deep)    walk 940   rect 940   delta 0   div > div > body
```

Delta zero, and the chain reaches `body` from inside a shadow root — the walk traverses the
flattened tree, so neither depth nor closedness distorts a timeline. Events are `composed` and carry
`detail.element`, so a listener outside a component sees which inner element fired rather than the
retargeted host.

## What you still have to do

1. **One call per root, per level.** Nesting is not recursive: `observe(outer)` does not find a
   shadow root inside `outer`, and the observer stays blind to elements added inside it. The `'init'`
   insert handles this by construction — it fires for every component, including nested ones — but a
   page registering roots by hand has to walk every level itself.
2. **`unobserve` on teardown.** `_cleanups` is the place.
3. **Nothing for iframes.** A cross-origin `contentDocument` is `null` in all three engines and
   there is no way in. A same-origin one is reachable and `observe(iframe.contentDocument)` would now
   be accepted — but geometry would be measured against the *parent's* scroll window while the iframe
   scrolls in its own. That is untested and unsupported; it would need a `scrollElement` per root.
