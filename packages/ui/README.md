# @verajs/ui

VeraJS components: styled, accessible, form-associated custom elements over `@verajs/hooks`.
Shadow DOM by default, light DOM by attribute, restylable without a fight.

> **Private while the API settles.** The surface contract ships as `custom-elements.json`,
> generated from each component's declared surface and enforced by the gate — an API change
> without its manifest diff refuses to land.

```js
import '@verajs/ui';          // registers <vera-select>
```

```js
import { VeraSelect } from '@verajs/ui/elements';  // classes only — you control registration
```

## The styling contract

- **Works untouched**: each component carries its stylesheet; nothing to import, nothing to
  configure, and only the components you use are paid for.
- **Theme by token**: every color, radius and focus value is a semantic `--vera-*` custom property
  with a real fallback. Custom properties inherit through shadow boundaries, so one `:root` block
  themes everything; dark mode is a token redefinition.
- **Override anything**: every internal node carries a `part`, so `vera-select::part(trigger)`
  reaches it in shadow mode — and in light mode (`<vera-select light>`) the same `[part="trigger"]`
  is a plain selector. Component selectors are wrapped in `:where()`, held at zero specificity:
  any rule you write wins, no `!important`.
- **Own the markup**: supply any part by slot (`<button slot="trigger" class="…">`) and it is wired
  with the same handlers and ARIA as the built-in one. Slotted content lives in your light DOM —
  your stylesheet and your Tailwind utilities style it normally, with no scanner configuration,
  because the classes are in your source.
- **State is styleable**: open/closed and the active row are `data-state`/`data-active`
  attributes, for `data-[state=open]:` -style variants.

Two library versions on one page warn instead of silently forking — and `@verajs/ui/elements`
exists for the page that must control registration itself.
