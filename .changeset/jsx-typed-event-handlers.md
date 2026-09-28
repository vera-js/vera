---
'@verajs/jsx': patch
---

TSX event handlers on built-in elements infer their event, so `onClick={(e) => …}` compiles under `strict`

Every element's props were one `Record<string, unknown>`, so an inline handler had nothing to infer
from and `strict` rejected it with TS7006 — every handler had to name its event and cast
`currentTarget` by hand. Handlers on HTML, SVG and MathML elements are now typed from TypeScript's
own DOM library: `onInput={(e) => e.currentTarget.value}` is an `InputEvent` on an
`HTMLInputElement`, and `onClick` a `PointerEvent`.

- Both `onKeyDown` and `onKeydown` are typed; the compiler lowercases whatever follows `on`, so
  every casing binds the same event.
- A handler may be anything the renderer accepts: a function (called with the element as `this`),
  a `{ handleEvent }` object, or `false`, `null` or `undefined` for none — `onClick={open && close}`
  type-checks.
- An `on…` name the DOM library does not know, such as a custom event, gets a plain `Event`, as
  `addEventListener` does. A handler declared ahead with a narrower type, `(e: MouseEvent) => …`,
  still fits.
- A number or a string where a handler belongs is now an error. Nothing else changes: other props
  stay permissive, custom elements accept anything, and declaring your own elements' props by
  merging into `JSX.IntrinsicElements` works as before.

Types only — no runtime change, no bytes.
