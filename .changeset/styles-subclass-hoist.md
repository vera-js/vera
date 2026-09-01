---
'@verajs/styles': patch
---

Hoist a subclass's light-DOM `static styles` instead of skipping them.

Hoisting is deduplicated with a flag on the component class — `if (owner[HOISTED]) return`. But
`class Child extends Base` makes `Base` the prototype of `Child`, so that read finds the flag the base
already set and returns. The subclass's `static styles` were never hoisted at all: the component
rendered unstyled, with nothing logged.

It was order-dependent, which is what made it survivable. Inheritance only looks upward, so mounting
the child first hoisted both — the child set its own flag and the base still had none of its own. Only
base-before-child failed, so a page could style correctly in development and not in production,
decided by which instance rendered first.

The flag is now read as an own property. That also fixes a subclass which declares no styles of its
own: it inherits the base's CSS, but its tag is different, so the base's `@scope (base-tag)` block
never matched it. It now hoists its own scoped copy.

Deduplication is unchanged otherwise — still once per class, however many instances.
