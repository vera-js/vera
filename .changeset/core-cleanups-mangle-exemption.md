---
'@verajs/core': patch
---

`_cleanups` joins the mangle exemptions — it is a cross-boundary contract

Core's production build mangles `_`-prefixed properties, with an exemption list for the names
other bundles reach structurally: `_p`, `_isSignal`, `_ignore`, `_delete`, `_root`, `_hooks`,
`_$…`. `_cleanups` was not on it, and it is exactly such a contract: `@verajs/motion`'s vera
adapter registers each component's release into `element._cleanups`, which core drains on
`disconnectedCallback`. In every production build the drain read a renamed property, the
adapter's optional-chained read came back `undefined`, and component roots were never released
on unmount — silently, and in production only, the same failure shape `_hooks`' own docblock
warns about.

Found by a cross-package sweep for structural `_` reads (2026-09-01): the full set reaching
across bundles is `_root` (styles' closed-shadow-root fallback, and the motion adapter) and
`_cleanups` (the motion adapter) — the first was already exempt, the second now is.
`tests/core-structural-contracts.test.mjs` pins both on a live element, in the production run
where the defect lived; verified to fail against the unfixed build.
