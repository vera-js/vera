# @verajs/jsx

JSX/TSX for VeraJS, with **zero dependencies and zero runtime cost**. A hand-rolled parser compiles
JSX into the renderer's tagged templates at build time, so what ships is `html\`…\`` — the same
engine, the same fast paths, nothing added to the bundle.

**One JSX call site is one template call site.** Nested markup becomes inline statics rather than
nested calls, so template identity holds and the renderer's caching, keyed lists and part reuse all
behave exactly as they do in hand-written templates.

Buildless stays the baseline; this is the opt-in for people who already run a build. It is **React
DX on web standards, not React compatibility**: components stay platform classes, and JSX only
styles the templates.

```sh
npm i -D @verajs/jsx
```

## Setup

```js
// vite.config.js
import { veraJsx } from '@verajs/jsx';

export default { plugins: [veraJsx()] };
```

Files ending `.jsx` or `.tsx` are transformed; everything else is left alone. Imports for `html` and
`keyed` are added when a file needs them.

| Option | Default | Means |
| --- | --- | --- |
| `inject` | `true` | Add the `html` / `keyed` imports. `false` if you import them yourself |
| `html` | `['html', '@verajs/core']` | `[export, module]` to import `html` from |
| `keyed` | `['keyed', '@verajs/renderer']` | `[export, module]` to import `keyed` from |

For a playground with no build at all, `@verajs/jsx/standalone` transforms
`<script type="text/vera-jsx">` blocks in the browser. It is for demos — the transform runs on every
page load.

`transformJsx(source, fileName, options?)` is the transform itself, if you are wiring a different
bundler or writing a test.

## What JSX means here

Everything below is the *whole* mapping. An attribute that appears in none of these rules is written
into the template verbatim, which is what you want for `data-*`, `aria-*`, `xlink:href` and every
ordinary HTML attribute — **write those exactly as they appear in HTML**, not camel-cased.

| Written | Becomes | Notes |
| --- | --- | --- |
| `<p>{x}</p>` | `html\`<p>${x}</p>\`` | |
| `<p class={c}>` | `<p class=${c}>` | an attribute |
| `className` / `htmlFor` | `class` / `for` | the only two renamed |
| `onClick={f}` | `@click=${f}` | any `on` + capital: the rest is lower-cased |
| `value` / `checked` | `.value=` / `.checked=` | properties, because the attribute is only the *default* |
| `defaultValue` / `defaultChecked` | `value=` / `checked=` | the attribute, when you mean the default |
| `hidden`, `disabled`, `open`, … | `?hidden=${…}` | the boolean-attribute table below |
| `<p hidden>` | `<p hidden>` | a bare boolean stays static |
| `key={id}` | `keyed(id, html\`…\`)` | on the root element returned from a list callback |
| `ref={r}` | `<p ${r}>` | the element-position ref |
| `{...rest}` | `spread(rest)` | imports `@verajs/renderer/spread` |
| `dangerouslySetInnerHTML={{ __html: h }}` | `.innerHTML=${h}` | the shape is checked |
| `<Comp a={1}>kids</Comp>` | `Comp({ a: 1, children: […] })` | a capitalised tag is a function call |
| `<>…</>` | the children, with no wrapper | |
| `{/* … */}` and `{}` | nothing | |

Boolean attributes: `disabled`, `hidden`, `readonly`, `required`, `open`, `selected`, `multiple`,
`autofocus`, `autoplay`, `controls`, `loop`, `muted`, `playsinline`, `inert`, `reversed`.

### The renderer's sigils work too

`.prop=`, `?bool=`, `@event=` and `&ref=` mean in JSX exactly what they mean in `html`, and a name
you spell with a sigil is passed through untouched — no rule above tries to guess a second one for
it.

<!-- recipe -->
```js
import { transformJsx } from '@verajs/jsx';

const out = transformJsx('const view = <x-row .rows={data} ?busy={loading} @select={onPick} />;', 'row.jsx');
console.log(out.includes('.rows=${data}') && out.includes('?busy=${loading}') && out.includes('@select=${onPick}'));
```

**This is the only way to hand a custom element structured data.** `rows={data}` is an *attribute*,
and an attribute can carry a string — so an array arrives as `"1,2,3"`. `.rows={data}` gives the
element the array. React has no equivalent because React has no custom elements to hand it to.

### Text

Whitespace collapses the way it does in React: a run containing a newline vanishes at the edges of a
text node and becomes one space inside it, so indentation never reaches the page. Character
references (`&amp;`, `&nbsp;`) are passed through for the browser to decode, and a backtick, a
backslash or a literal `${` in text is escaped into the emitted template rather than becoming part
of it.

### `style` takes a string

```jsx
<p style={`color: ${c}`}>…</p>     // yes
<p style={{ color: c }}>…</p>      // refused, with the line and column
```

An object would need a runtime helper to serialize it, on every render, in a package whose entire
claim is that it adds nothing to the bundle. A template literal is the same characters.

## What it refuses, and where

Every mistake below is reported with the file, line and column — not left for the next tool to
choke on:

- a closing tag that names a different element (`<p>…</b>`)
- `key` anywhere but the JSX root returned from a list callback
- `dangerouslySetInnerHTML` in any shape other than `{{ __html: … }}`
- `style` given an object
- a sigil with no value (`.rows` on its own)

**Anything else that does not parse is left exactly as it was**, and that is deliberate: `<` is
ambiguous, and `a < b` has to survive a file being run through this. The cost is that a genuinely
unclosed element (`<p>x` with no `</p>`) reaches your bundler as written and is reported by *it*.

## TypeScript

`packages/jsx/src/types.d.ts` is the JSX namespace. Set `"jsx": "preserve"` in `tsconfig.json` and
let the plugin do the transform — `react-jsx` would emit `_jsx()` calls this never sees.

## What it is not

It does not make Vera components React components. `<Comp />` calls `Comp` as a function and uses
what it returns; there is no reconciler, no hooks-by-position and no synthetic event system. A
component is a custom element, defined the way every other Vera component is, and JSX is how you
write the markup inside it.
