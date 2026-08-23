---
'@verajs/core': minor
---

Export `svg` and `mathml`, and stop re-exporting `connectInserts`.

**`svg` and `mathml` were defined and never exported.** `@verajs/renderer` has always read
`_$litType$` and wrapped markup in `<svg>` or `<math>` before parsing, precisely so the fragment
lands in the right namespace — but nothing in core produced those types, so the support was
unreachable. A user had to import lit-html's `svg` or hand-craft `{ _$litType$: 2, strings, values }`.

Namespace is not a nicety here: `document.createElement('circle')` produces an `HTMLUnknownElement`
that parses fine and never renders. Only a fragment parsed inside `<svg>` yields a real
`SVGCircleElement`. Costs 32 B for both.

**`connectInserts` is no longer re-exported from core.** It connects *a module's* registry to core's,
so every documented use imports it from the module being connected — `@verajs/router` — never from
here. Re-exporting it made core carry its replay loop for a call nothing makes, and core is 24 B
smaller without it. The types are still re-exported, so `RendererInsert`, `InitInsert` and the rest
remain available from `@verajs/core`; only the value is gone, and TypeScript reports its use
precisely rather than failing at runtime.

This is the breaking part, hence minor. Only `@verajs/core` and `@verajs/router` carry a registry at
all, and the router still exports the function, so `connectInserts(inserts)` — the documented CDN
wiring — is unchanged.

Net effect on core: 2 577 B to 2 585 B, +8 B for two exported tags and a smaller insert surface.
