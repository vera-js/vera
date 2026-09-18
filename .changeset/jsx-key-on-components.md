---
'@verajs/jsx': patch
---

`key` on a function component type-checks in TSX

`<Card key={id} title="x" />` was `TS2322 — Property 'key' does not exist on type '{ title: string }'`,
while the same `key` on a dash-named tag was fine and both compiled and ran correctly. The types were
forbidding a feature the transform implements: `key` is handled in BOTH emitters on purpose —
`tpl.setKey()` for an element, and the component emitter lifts it out of the props bag before the
rest become properties — and `packages/jsx/README.md` documents it as working on "element **or**
component".

The gap was `JSX.IntrinsicAttributes`, which the package never declared. A dash-named tag resolves
through `IntrinsicElements`' index signature and accepts anything, so nothing in the repo showed it;
a function component is checked against its own parameter type, and `IntrinsicAttributes` is the
interface TypeScript intersects into every component's allowed props — where React declares `key`.

`key?: unknown` rather than React's `string | number`: this renderer compares keys by value and
`TemplateResult.key` is `unknown`, so any identity is legitimate.

Reported by a TSX app that had kept a cast as a workaround. The cast can go.

Now covered by `tests/consumer/tsxcheck.tsx`, which compiles TSX against the SHIPPED declarations
through the tsconfig the docs tell people to write. The existing consumer check could not reach it —
the JSX namespace is ambient, so only a file containing JSX exercises it.
