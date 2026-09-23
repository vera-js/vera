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

Files ending `.jsx` or `.tsx` are transformed; everything else is left alone. Imports for `html`,
`keyed`, `spread`, `svg` and `mathml` are added when a file needs them.

| Option | Default | Means |
| --- | --- | --- |
| `inject` | `true` | Add the imports below. `false` if you import them yourself |
| `html` | `['html', '@verajs/core']` | `[export, module]` to import `html` from |
| `keyed` | `['keyed', '@verajs/renderer/keyed']` | `[export, module]` to import `keyed` from |
| `spread` | `['spread', '@verajs/renderer/spread']` | `[export, module]` to import `spread` from, for `{...rest}` on elements |
| `svg` | `['svg', '@verajs/core']` | `[export, module]` for expressions inside `<svg>` — see [SVG and MathML](#svg-and-mathml-just-work) |
| `mathml` | `['mathml', '@verajs/core']` | the same, for expressions inside `<math>` |

**Writing TSX? Add the types, or nothing type-checks.** The JSX namespace ships with this package's
declarations, but a TSX app imports `@verajs/core` and never imports the plugin, so TypeScript
never loads them and every element errors with **TS7026** (*"JSX element implicitly has type 'any'
because no interface 'JSX.IntrinsicElements' exists"*). One line fixes it — see
[TypeScript](#typescript):

```jsonc
// tsconfig.json
{ "compilerOptions": { "jsx": "preserve", "types": ["@verajs/jsx"] } }
```

For a playground with no build at all, `@verajs/jsx/standalone` transforms
`<script type="text/vera-jsx">` blocks in the browser. It is for demos — the transform runs on every
page load. Blocks present at `DOMContentLoaded` run in document order automatically; a block that
arrives LATER — CMS content, a demo injected after load — is run by hand with `runBlock`:

```js
import { runBlock } from '@verajs/jsx/standalone';

const script = document.querySelector('script[type="text/vera-jsx"]#late');
await runBlock(script);   // fetches src or reads inline text, transforms, imports as a module
```

`transformJsx(source, fileName, options?)` is the transform itself, if you are wiring a different
bundler or writing a test:

```js
import { transformJsx } from '@verajs/jsx';

const js = transformJsx(source, 'widget.jsx');                    // imports injected automatically
const bare = transformJsx(source, 'widget.jsx', { inject: false }); // you provide html/keyed/spread
```

## What JSX means here

Everything below is the *whole* mapping. On an **HTML tag**, an attribute that appears in none of
these rules is written into the template verbatim, which is what you want for `data-*`, `aria-*`,
`xlink:href` and every ordinary HTML attribute — **write those exactly as they appear in HTML**,
not camel-cased.

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
| `key={id}` | `keyed(id, html\`…\`)` | on the root of a list callback — element **or** component |
| `ref={r}` | `<p ${r}>` | the element-position ref |
| `{...rest}` | `spread(rest)` | imports `@verajs/renderer/spread` |
| `dangerouslySetInnerHTML={{ __html: h }}` | `.innerHTML=${h}` | the shape is checked |
| `<Comp a={1}>kids</Comp>` | `Comp({ a: 1, children: […] })` | a capitalised tag is a function call |
| `<>…</>` | the children, with no wrapper | |
| `<div />` | `<div></div>` | **the element decides how the tag closes, not the spelling** |
| `<br></br>` | `<br />` | the same rule, the other way |
| `{/* … */}` and `{}` | nothing | |
| `.prop=`, `?bool=`, `@event=`, `&ref=` | passed through untouched | the renderer's own sigils; **`.jsx` only** — TSX cannot parse them ([TypeScript](#typescript)) |

Boolean attributes: `disabled`, `hidden`, `readonly`, `required`, `open`, `selected`, `multiple`,
`autofocus`, `autoplay`, `controls`, `loop`, `muted`, `playsinline`, `inert`, `reversed`.

**Two rules depend on where the tag sits**, and both have their own section because neither is a
name in a table:

| Where | Written | Becomes | |
| --- | --- | --- | --- |
| on a **dash-named** tag | `<calendar-day date={d}>` | `.date=${d}` — a **property** | [below](#on-a-component-tag-a-prop-is-a-prop) |
| inside `<svg>` / `<math>` | `{pts.map((p) => <circle … />)}` | `svg\`<circle …>\`` | [below](#svg-and-mathml-just-work) |
| any **child** position | `{cond && <em/>}` | nothing when `cond` is false | [below](#a-boolean-child-renders-nothing) |

### On a component tag, a prop is a prop

On a **dash-named tag**, JSX means what it means in React: `<calendar-day date={date} count={3}
active>` passes `date`, `count` and `active` (`true`) as **properties**, by identity — the
component reads `this.date`, reactively, with nothing declared (see `@verajs/core`'s Props
section). `date="literal"` is a prop too, and none of the HTML-control guesses above apply —
`disabled={x}` on a component is that component's own prop, not a `?disabled` toggle.

No table decides which names qualify. Two derivations carve out the attributes: a **name that
cannot be a JS identifier** (`data-*`, `aria-*`, `xlink:href`) has no property spelling by
construction, and `class` / `for` (the two
names the DOM itself renamed, because JS refuses them as identifiers) stay attributes — write
`className` on components exactly as in React. Everything else is classified by the element's own
prototype chain at runtime: `title`, `id`, `slot` or `style` land on the platform accessor that
owns them and reflect as always, a class's declared `get`/`set` pair receives through its setter,
and the rest adopt. Server rendering delivers the same props to the child's server render.

### Self-closing is JSX's syntax, not HTML's

JSX borrows `<div />` from XML. HTML has no such thing outside `<svg>` and `<math>`, so the element
decides how its tag closes and the compiler emits accordingly — `<div />` becomes `<div></div>`,
`<br></br>` becomes `<br />`. Write either; they mean what you expect.

This is not cosmetic. Passed through, both spellings were wrong in opposite directions and silently:

```jsx
<div /><span>after</span>     // parsed as <div><span>after</span></div> — the sibling is swallowed
<br></br>                     // parsed as <br><br> — one break, rendered twice
```

Nothing failed, on either side: the server and the client agreed, and the DOM simply had a shape the
source never described. A **hand-written** template has the same hazard and no compiler to fix it,
so `@verajs/renderer` warns about both in development.

**One precedence difference from React, on purpose.** A spread key overwrites a *static* attribute
of the same name wherever the spread sits — `<i {...bag} title="x" />` renders the bag's `title`,
where React's later-wins rule would render `"x"`. Statics are parsed into the template before any
binding runs, and a spread commits at render time; the renderer's rule (a spread key *replaces* a
static, identically on client and server — see `@verajs/renderer`'s spread docs) is
position-independent by construction. Every dynamic-vs-dynamic order works as in React: a later
spread beats an earlier one, and a later *written binding* like `disabled={false}` beats an
earlier spread's `true`. When a static must win, write it as a binding — `title={"x"}` — or drop
the key from the bag.

### SVG and MathML just work

A template's namespace is decided by the tag that parses it, which is why hand-written templates
reach for core's `svg`/`mathml` tags inside `<svg>`/`<math>`. In JSX the compiler picks the tag for
you, from the position the expression is written in:

```jsx
<svg viewBox="0 0 24 24">
  {points.map((p) => <circle key={p.id} cx={p.x} cy={p.y} r="2" />)}   // compiles with svg``
  <foreignObject><div>{label}</div></foreignObject>                    // …and this flips back to html``
</svg>
```

Shapes mapped in a list, built conditionally, or written inline all parse in the SVG namespace —
no workaround, nothing to import (the `svg` import is injected like `html` is).

**Shapes handed to a component work too**, which lexical position alone cannot decide:

```jsx
const Frame = ({ children }) => <svg viewBox="0 0 24 24">{children}</svg>;
<Frame><path d="M0 0h24" /></Frame>     // the <path> is written outside any <svg>
```

The call site cannot know what `Frame` renders — but it does not need to. `<path>` is not an HTML
element in any context, so a template whose ROOT is an SVG-only name compiles with `svg` wherever it
was written. That covers children passed directly, through a `<>…</>` fragment, and through a mapped
list.

**Three kinds of name are deliberately left out**, and every omission is conservative — they fall
back to the previous behaviour rather than mis-tagging anything:

- the ones SVG shares with HTML (`a`, `title`, `script`, `style`, `image`, `font`), because guessing there
  would break real HTML;
- the ones carrying visible content (`text`, `desc`, `foreignObject`, `tspan`, …), because the
  upgrade fires on the root tag alone and so also applies to a template bound for an HTML parent —
  `<Box><text>hi</text></Box>` would go from readable text to a 0×0 SVG element;
- the camelCase ones (`clipPath`, `linearGradient`, `animateTransform`, …), which a server emits
  verbatim and a browser parses lowercased outside an `<svg>`, so hydration would discard the
  server's markup and rebuild.

The last two are almost always written *inside* an `<svg>` anyway, where lexical position already
answers.

A root is never upgraded when a component or custom element lies anywhere the compiler would tag
it — in the children, or inside an expression like `{rows.map((r) => <my-card key={r} />)}` — and
never when an ATTRIBUTE carries JSX at all, of any kind. A handler's template goes wherever the
handler puts it, which the shape around it cannot know, so `<circle onClick={() => open(<form/>)}/>`
keeps its root HTML rather than building that form in the SVG namespace. Upgrade is spec-gated on the HTML namespace, so
an SVG-namespaced custom element never runs its `connectedCallback` at all.

`<foreignObject>`, `<desc>` and `<title>` are SVG's HTML integration points, and all three are
exempt: their content parses as HTML there, so an element or a component beneath one is safe and
the shape around it still draws. The island's own ATTRIBUTES are still checked, since those are
emitted in the outer namespace.

The one shape an island cannot take is a STATIC element inside a `<title>`. `@verajs/renderer` scans
`<title>` as raw text in every template, by one rule deliberately shared with its parsed-tree pass,
so an element written there is dropped, a binding's sigil is left behind as a dead attribute, and a
spread throws. An EXPRESSION never reaches that — it becomes its own template, committed as a child,
never scanned as `<title>`'s statics. So `<g><title>{label}</title><path /></g>` upgrades and draws,
`<g><title>{flag && <my-badge />}</title><path /></g>` upgrades and the badge still upgrades as a
custom element, and only `<g><title><tspan /></title></g>` keeps the behaviour it had.

MathML's token elements (`<mi>`, `<mo>`, `<mn>`, `<ms>`, `<mtext>`) are the equivalent for CHILD
MODE — an expression inside one compiles `html`. They never exempt a root from refusal, because a
root is only ever upgraded to `svg`: inside an `svg` template a `<math>` does not switch namespace,
so an `<mtext>` there really is SVG.

**A SIBLING vouches for a name a root tag alone cannot prove.** `<title>` is the canonical case and
the one that mattered: SVG shares the name with HTML, so it is never upgraded on its own — but a
component's children are emitted as separate roots, so

```jsx
<Frame><title>{label}</title><path d={d} /></Frame>
```

built the `<title>` as HTML inside the `<svg>`, where it is the accessible name of nothing. The
`<path>` beside it settles the question: one SVG-only name in a sibling group puts the group in SVG,
so the names excluded only because *a root tag alone cannot prove context* — `title`, `a`, `style`,
`script`, `image`, `font`, `text`, `tspan`, `desc`, `metadata`, `switch`, `view`, `set`, `filter`,
`mask`, `marker`, `pattern`, `symbol` — come with it. Alone they are untouched, so
`<Box><text>hello</text></Box>` is still readable text and not a 0×0 SVG element. An expression vouches through its own roots, so a mapped list of
shapes counts; one that mixes namespaces or yields nothing knowable does not. The vouch travels both ways: a sibling also settles what an
expression's own roots compile as, so `<Frame><path />{labels.map((t) => <text>{t}</text>)}</Frame>`
gives every `<text>` the group's namespace.

The camelCase names stay out even here. Their hazard is not the root-tag one: `@verajs/ssr` emits the
strings verbatim and a browser lowercases them outside an `<svg>`, so hydration would discard and
rebuild. A sibling says what the group IS, not where it lands.

So `<Frame><a>text</a></Frame>` with no SVG sibling still compiles the `<a>` as HTML. `@verajs/renderer` names that
in development, on every path a component's children actually take — they arrive as an array and
reach the DOM through the list path, not the single-child one — and the message names both remedies,
since `` svg`…` `` is right for an SVG element compiled as HTML and `<foreignObject>` is right for
something genuinely HTML.

### A boolean child renders nothing

React's rule, in the grammar React users write:

```jsx
{items.length > 0 && <em>{items.length} items</em>}   // renders nothing when the list is empty
```

A hand-written template renders the word **"false"** there, matching lit — and `@verajs/renderer`
says so in development. **This is the one value semantic on which JSX and a template differ.** It is
done by filtering the child in your own module, so the renderer and `@verajs/ssr` never learn a new
rule: they receive `null`, which they already drop.

That filter is the one thing this compiler adds to your output, so it is worth recognising:

```js
const $veraChild = (v) => (typeof v === 'boolean' ? null : v);   // injected, ~60 B, once per module
```

It is emitted only into modules that have JSX child expressions, and it steps aside — `$veraChild2`,
`$veraChild3` — if your module already uses the name.

**The injected TAG names step aside the same way.** If your module binds a name an import would
claim — `const svg = …`, `const { html, svg } = vera`, `const [svg] = …`, or a parameter called
`svg` — the import is renamed rather than duplicated, and the emitted templates use the new name:

```js
const svg = document.querySelector('svg');
export const icon = <path d="M0 0h24" />;
// →  import { svg as $veraSvg } from '@verajs/core';
//    export const icon = $veraSvg`<path d="M0 0h24"></path>`;
```

Without it the module is a `SyntaxError` — *"Identifier 'svg' has already been declared"* — which a
browser catches and logs, so the page simply does nothing. A module that does not mention the name
keeps the plain one, and a module that hand-writes `` html`…` `` beside its JSX keeps it too, since
that is a reference to the very import being added. With `inject: false` nothing is renamed: the
bindings are yours.

Two consequences worth knowing:

- **Only booleans.** `{0 && <x/>}` still renders `0`, exactly as React does — the rule is about
  booleans, not falsiness.
- **A boolean *inside an array* still renders** — the filter sees the array, not its items, so
  `{rows.map((r) => r.ok && <li/>)}` puts "false" on the page for each failing row. Development
  names it, and `{rows.filter((r) => r.ok).map(…)}` is the fix. **This is where vera and React
  deliberately part**, and the reason is measured: React filters children recursively, and doing
  the same here costs ~135 ns against ~15 ns per list child *even when the array holds no
  booleans at all* — roughly doubling the commit of every list to correct a case the development
  warning already names. Paying that on every list to fix some lists is the wrong trade for a
  renderer whose lists are its hottest path.

A module that compiles no JSX children carries none of this.

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
- `key` anywhere but the JSX root returned from a list callback — on an element or a component
- children inside a void element (`<input>{label}</input>`), which no markup can express: passed
  through, the binding silently left the element it was written inside
- `dangerouslySetInnerHTML` in any shape other than `{{ __html: … }}`
- `style` given an object
- a sigil with no value (`.rows` on its own)

**Anything else that does not parse is left exactly as it was**, and that is deliberate: `<` is
ambiguous, and `a < b` has to survive a file being run through this. The cost is that a genuinely
unclosed element (`<p>x` with no `</p>`) reaches your bundler as written and is reported by *it*.

## TypeScript

Two settings, and the second is the one people miss:

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "preserve",          // the PLUGIN transforms JSX — `react-jsx` would emit _jsx() calls this never sees
    "types": ["@verajs/jsx"]    // loads the JSX namespace, without which nothing type-checks
  }
}
```

**Why the second line is required.** This package ships the JSX namespace with its generated
declarations — but a TSX app imports `@verajs/core` and configures the plugin in `vite.config.js`;
it never *imports* `@verajs/jsx`, so TypeScript never loads its declarations and every element
errors with **TS7026**. Naming it in `types` loads the ambient declarations without importing
anything at runtime. A per-file `/// <reference types="@verajs/jsx" />` works identically if you
would rather not touch `types` (which, once set, also narrows what else is auto-included).

**What the typings do and do not check.** They are deliberately permissive — every element accepts
every prop (`IntrinsicElements` is an index signature), so TSX compiles today and `key={id}`,
`onClick={fn}` and bare props on a component all type-check. A fully typed per-element surface is
the known long tail. Two consequences worth knowing:

- **A misspelled prop is not caught by TypeScript here.** For the props you pass a component, the
  checked path is `props<CalendarDay>({ dat })` from `@verajs/renderer/spread`, which *is* checked
  against the element and names the misspelling.
- **The sigil spellings do not parse in TSX.** `.date={d}` is valid in `.jsx` and trips **TS1003**
  (*"Identifier expected"*) in `.tsx`, because the TypeScript parser reads the attribute name
  before this plugin ever sees the file. In TSX, write the bare prop (`date={d}`) — which means the
  same thing on a component tag — or `{...props({ date })}`.

## What it is not

It does not make Vera components React components. `<Comp />` calls `Comp` as a function and uses
what it returns; there is no reconciler, no hooks-by-position and no synthetic event system. A
component is a custom element, defined the way every other Vera component is, and JSX is how you
write the markup inside it.

## For AI assistants — and anyone who wants the whole API on one page

The repository root's [`llms.txt`](../../llms.txt) is the complete, hand-maintained API
reference for every package, written to be pasted into a model's context window: full export
tables, the buildless CDN and JSX recipes, semantics that differ from other frameworks, and the
mistakes that come up most. Its recipes are executed by the test suite, so they stay honest.
