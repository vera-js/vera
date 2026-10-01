---
'@verajs/renderer': patch
---

`@verajs/renderer/tag`: four component fixes

- `tag('h1')`, called as a function rather than a tagged template, is refused in every build. Production used to
  render a silent `<h>`.
- A void tag renders one element: `` tag`br` `` no longer emits `<br></br>` (two `<br>`s by the parser's rule),
  and children given to one are refused in development rather than silently dropped.
- A custom-element tag maps props the way compiled JSX does: an identifier prop is a property (`.foo`), its own
  `disabled` is a property rather than the HTML boolean, `data-*`/`aria-*` and `class`/`for` stay attributes, and an
  object `style` is refused in development.
- A tag outside tag position (as text, an attribute value or an attribute name) is refused in development.
