---
'@verajs/jsx': minor
---

On a component tag, a bare prop is a prop — and SVG/MathML content just works

Two changes to what JSX compiles to on dash-named tags, both breaking on that surface (0.x rules:
minor).

**Bare props are props**, React's own semantics: `<calendar-day date={d} count={3} active>` emits
`.date=${d}`, `.count=${3}`, `.active=${true}` — properties by identity, adopted reactively by
`init()` with nothing declared, delivered to the child's server render by `@verajs/ssr`. Bound,
literal and bare-flag values alike, in the build plugin and the buildless standalone path both. No
name table decides what qualifies: a name that cannot be a JS identifier (`data-*`, `aria-*`,
`xlink:href`) has no property spelling by construction and stays an attribute, and `class`/`for` —
the two names the DOM itself renamed — stay attributes (write `className`, as in React). The
HTML-control guesses (`value`/`checked`, the boolean table, `default*`) no longer reach a
component: `disabled={x}` is the component's own prop, never a `?disabled` toggle. HTML tags are
untouched. Previously a bare bound attribute on a dashed tag was an attribute — an array arrived
as `"1,2,3"`; that spelling now delivers the array.

**Expressions inside `<svg>`/`<math>` compile their roots in the right namespace.** A map
callback's shapes inside `<svg>` compiled as `html\`\`` and parsed as HTMLUnknownElements that
never drew — and JSX had no `svg\`\`` of its own, so no spelling worked. The surrounding element
now decides, lexically: `<svg>` children compile with core's `svg` tag, `<math>` with `mathml`,
`<foreignObject>` flips back to HTML, imports injected like `html`'s. One boundary: a function
component compiles where it is defined, so give an icon component its own `<svg>` wrapper or
define the shape inline.
