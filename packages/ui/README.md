# @verajs/ui

VeraJS components: styled, accessible, form-associated custom elements over `@verajs/hooks`.
Shadow DOM by default, light DOM by attribute, restylable without a fight.

> **Private while the API settles.** The surface contract ships as `custom-elements.json`,
> generated from each component's declared surface and enforced by the gate — an API change
> without its manifest diff refuses to land.

```js
import '@verajs/ui';          // registers <vera-select>
```

Buildless-first: options can be authored in plain HTML — `<option>`, `<optgroup>`, and
`<vera-option>` for rows with markup (icons, rich descriptions), since `<option>`'s parser drops
element children on engines without the customizable-select relaxation. `selected` seeds the
value and the form-reset default. HTML seeds, the `.options` property wins.

```html
<vera-select name="flavor">
  <optgroup label="Classics"><option value="vanilla" selected>Vanilla</option></optgroup>
  <vera-option value="pistachio"><svg slot="icon">…</svg> Pistachio</vera-option>
</vera-select>
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

## The select's surface (see `custom-elements.json` for the full contract)

`multi`, `searchable`, `creatable` (cancelable `create` event), `remote` (debounced `filter`
event + `loading`/`overflow-message` — the async-typeahead seam), `required` (real constraint
validation), `placeholder`, `search-placeholder`, `empty-message`, `debounce`, `light`, `name`,
`aria-label` (reflected onto the trigger; an associated `<label for>` also names it, through
ElementInternals). Properties `options`, `value` (mode-consistent strings — string in single, `string[]` in multi; `el.value = 'b'` just works), `selectedOptions` (the objects, native-select style); events `input`/`change`/`create`/`filter`/`beforetoggle`/`toggle`; methods `open()`/`close()`.

Two library versions on one page warn instead of silently forking — and `@verajs/ui/elements`
exists for the page that must control registration itself.
