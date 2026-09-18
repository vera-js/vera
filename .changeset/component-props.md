---
'@verajs/core': patch
'@verajs/renderer': patch
---

Components receive bound properties with no declaration

A parent binds properties — `.date=${…}` in a template, `props({ date })` in either surface, a
sigil-keyed spread bag — and the component reads them off `this`, reactively: a read in a render
is tracked, the parent's next commit lands in the setter and re-renders, and stores and refs
arrive by identity and stay live. No `static properties`, no props argument to `init()`, no
`declare`.

`props()` is the new `@verajs/renderer/spread` export: a typed bag of property bindings
(`props<CalendarDay>({ dat })` is a compile error naming the misspelling), one call in template
and JSX alike, idempotent under the JSX compilation shape `spread(props({…}))`.

Both arrival orders work. An eagerly-defined component's values are recorded before `init()` runs;
a lazily-defined one's are recorded before upgrade and re-applied after it, which repairs the
ES2022 class-field clobber in BOTH spellings (`item;` and `item = default`) — a bound value
outranks a class default. A key arriving after `init()` — a hydrated child's late parent commit, a
spread bag growing a key — is adopted live and re-runs only the render hooks, never effects.
A class declaring its own `get`/`set` pair keeps it: values arrive through the setter, and a
getter with no setter refuses the binding by name in development instead of throwing — one rule
in every arrival order. Platform properties (`title`, `id`, `slot`, `style`) land on the platform
accessors that own them; elements that never call `init()` get plain writes exactly as before,
with the pre-upgrade clobber warning now firing once per binding instead of once per commit.

Measured: production custom-element property commits are unchanged in all three engines;
development commits got 3–8× faster (the old clobber detector ran `customElements.get` per
commit; detection now costs one subscription per binding).
