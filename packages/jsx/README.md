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
`keyed` and `spread` are added when a file needs them, and every compiled file wires
`@verajs/renderer/namespaces` — see [SVG and MathML](#svg-and-mathml-just-work).

| Option | Default | Means |
| --- | --- | --- |
| `inject` | `true` | Add the imports below. `false` if you import them yourself — and wire `@verajs/renderer/namespaces` yourself too, since that wiring is an injected import like the rest |
| `html` | `['html', '@verajs/core']` | `[export, module]` to import `html` from |
| `keyed` | `['keyed', '@verajs/renderer/keyed']` | `[export, module]` to import `keyed` from |
| `spread` | `['spread', '@verajs/renderer/spread']` | `[export, module]` to import `spread` from, for `{...rest}` on elements |
| `namespaces` | `true` | wire `@verajs/renderer/namespaces` from every compiled file, so a component's SVG children draw. `false` if you wire it yourself, or want neither its bytes nor SVG children |
| `onWarning` | the plugin: Vite's own `warn` | `(message) => …`, told of what compiles but is probably a mistake, as `file:line:col — message (code)`. Today: a controlled `value`/`checked` on an `<input>`, `<textarea>` or `<select>` with no `onInput`/`onChange` and no `readOnly` — every render writes it back over what was typed. A direct `transformJsx` call with no `onWarning` says nothing; the buildless loader prints it in development |

**Writing TSX? Add the types, or nothing type-checks.** The JSX namespace ships with this package's
declarations, but a TSX app imports `@verajs/core` and never imports the plugin, so TypeScript
never loads them and every element errors with **TS7026** (*"JSX element implicitly has type 'any'
because no interface 'JSX.IntrinsicElements' exists"*). One line fixes it — see
[TypeScript](#typescript):

```jsonc
// tsconfig.json
{ "compilerOptions": { "jsx": "preserve", "types": ["@verajs/jsx"] } }
```

**No build at all** — self-hosted, or from a CDN — is three entries in an import map and an app of
ordinary `.jsx` and `.js` files. Copy the three packages' `dist` folders beside your page (the
renderer's WHOLE folder: any `@verajs/renderer/<entry>` — the helpers compiled code imports, and
`slots` or `tag` if yours does — is loaded from beside it, so the map stays three lines):

```html
<script type="importmap">{ "imports": {
  "@verajs/core":     "/vendor/core/vera.min.js",
  "@verajs/renderer": "/vendor/renderer/vera-renderer.min.js",
  "@verajs/jsx":      "/vendor/jsx/vera-jsx-standalone.min.js"
} }</script>
<script type="module">import '@verajs/jsx';</script>
<script type="text/vera-jsx" src="/app/main.jsx"></script>
```

`@verajs/jsx/standalone` compiles each `<script type="text/vera-jsx">` block, inline or `src`, in the
page — and every file it imports: `import { Frame } from './frame.jsx'`, a relative `./util.js`,
`import('./page.jsx')` (or `` import(`./pages/${name}.jsx`) ``, or a full same-site URL),
`import.meta.url`, `import.meta.resolve` and a JSON module
(`import data from './data.json' with { type: 'json' }`) all work as written, a package name in them
resolves through the page's import map exactly as it would from the file itself, and a file behind a
redirect resolves its neighbors where it really is. A repeat visit compiles nothing, inline blocks
included: each file's output is kept by its URL and reused only for the exact text it was compiled
from — a fingerprint of the file, never a server header, so any static server works and an edit is
always seen — and the compiler itself (`vera-jsx.min.js`, beside the standalone file) is only loaded
when something must be compiled. A plain `.js` file keeps only where its imports are, so a vendored
library cannot fill the storage. If the renderer's helper files are missing from beside it, the
error names the file, wherever the import that needed it was.
Measured on a 40-module app, a warm visit is ~10–13 ms behind the same app built ahead of time in
Chromium and WebKit, and ~20 ms in Firefox.
**One thing it cannot do is a circular import** — it is reported, naming the loop; the Vite plugin
handles those. Blocks present at `DOMContentLoaded` run in document order; one that arrives later —
CMS content, a demo injected after load — is run by hand with `runBlock`:

```js
// Needs its own import-map entry — "@verajs/jsx/standalone" pointing at the same file as "@verajs/jsx".
import { runBlock } from '@verajs/jsx/standalone';

const script = document.querySelector('script[type="text/vera-jsx"]#late');
await runBlock(script);   // fetches src or reads inline text, compiles, links and imports it
```

`transformJsx(source, fileName, options?)` is the transform itself, if you are wiring a different
bundler or writing a test:

```js
import { transformJsx } from '@verajs/jsx';

const js = transformJsx(source, 'widget.jsx');                    // imports injected automatically
const bare = transformJsx(source, 'widget.jsx', { inject: false }); // you provide html/keyed/spread
```

`importSites(code)` is what the buildless loader links with: every static import specifier, every
`import(` call (the keyword and its parenthesis, with whether it passes import options) and every
`import.meta` in a module's text, located on a copy with its strings, comments and template text
blanked, so an `import` written inside a string is never mistaken for one.

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
| `value` / `checked` | `!value=` / `!checked=` | controlled, as React's are: compared with the control's LIVE state every render, so a value reset before the next render (`'x'` → `''` in one frame) is still written — and typed text is written back unless `onInput`/`onChange` keeps the value in step (the compiler warns when nothing does; `defaultValue` for an initial value, `readOnly` for a fixed one) |
| `defaultValue` / `defaultChecked` | `value=` / `?checked=${…}` | the attribute, when you mean the default (bare `defaultChecked` is a static `checked`) |
| `hidden`, `disabled`, `open`, … | `?hidden=${…}` | the boolean-attribute table below |
| `hidden=""`, `checked=""` | `${true}` | the empty string is how the platform writes a set boolean |
| `hidden="false"`, `checked="false"` | `${false}` | **a deliberate divergence** — HTML calls any present value true; every author who writes `"false"` means false |
| `<p hidden>` | `<p hidden>` | a bare boolean stays static |
| `key={id}` | `keyed(id, html\`…\`)` | on the root of a list callback — element **or** component |
| `ref={r}` | `<p ${r}>` | the element-position ref |
| `{...rest}` | `spread(rest)` | imports `@verajs/renderer/spread` |
| `dangerouslySetInnerHTML={{ __html: h }}` | `.innerHTML=${h}` | the shape is checked |
| `<Comp a={1}>kids</Comp>` | `Comp({ a: 1, children: […] })` | a capitalized tag is a function call |
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
| inside `<svg>` / `<math>` | `<Frame><path/></Frame>` | parsed where it lands — SVG | [below](#svg-and-mathml-just-work) |
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

JSX cannot write `` svg`…` ``, and it does not need to: every compiled file wires
`@verajs/renderer/namespaces`, which makes the renderer parse a template **in the namespace of the
position it lands in** — exactly as the browser's own parser treats markup inside an `<svg>`:

```jsx
const Frame = ({ children }) => <svg viewBox="0 0 24 24">{children}</svg>;

<Frame>
  <title>Close</title>
  <path d="M0 0h24" />
  <clipPath id="c"><rect width="12" height="24" /></clipPath>
</Frame>
```

All three children are SVG — `<title>` included, and `clipPath` keeps its case — because they land
inside `Frame`'s `<svg>`, although they are written outside it. The same holds for shapes mapped in a
list, built conditionally, passed through a `<>…</>` fragment or a component that only returns its
children, and for `<foreignObject>`, `<desc>` and `<title>` flipping back to HTML: nothing is
guessed from a tag's name, so `<Box><text>hi</text></Box>` stays readable text in a `<div>`.

The answer comes from the browser's parser, not from a list in this package — which is also why
server rendering and the client agree: the server writes the markup as authored and the browser
parses it in place, the same rule the client now follows. Measured against the parser itself, over
1 084 sibling groups in five kinds of parent, on Chromium, Firefox and WebKit.

A hand-written template gets the same behavior once `@verajs/renderer/namespaces` is wired, and
`svg`/`mathml` tags keep working either way. `namespaces: false` in the plugin options leaves it out.

### A boolean child renders nothing

React's rule, in the grammar React users write:

```jsx
{items.length > 0 && <em>{items.length} items</em>}   // renders nothing when the list is empty
```

A hand-written template renders the word **"false"** there, matching lit — and `@verajs/renderer`
says so in development. **This is the one value semantic on which JSX and a template differ.** It is
done by filtering the child in your own module, so the renderer and `@verajs/ssr` never learn a new
rule: they receive `null`, which they already drop.

That filter is the one thing this compiler adds to your output, so it is worth recognizing:

```js
const $veraChild = (v) => (typeof v === 'boolean' ? null : v);   // injected, ~60 B, once per module
```

It is emitted only into modules that have JSX child expressions, and it steps aside — `$veraChild2`,
`$veraChild3` — if your module already uses the name.

**The injected names step aside the same way.** If your module binds a name an import would
claim — `const html = …`, `const { html } = vera`, `const [html] = …`, or a parameter called
`html` — the import is renamed rather than duplicated, and the emitted code uses the new name:

```js
const html = await (await fetch('/fragment')).text();
export const view = <p>hi</p>;
// →  import { html as $veraHtml } from '@verajs/core';
//    export const view = $veraHtml`<p>hi</p>`;
```

Without it the module is a `SyntaxError` — *"Identifier 'html' has already been declared"* — which a
browser catches and logs, so the page simply does nothing. A module that does not mention the name
keeps the plain one, and a module that hand-writes `` html`…` `` beside its JSX keeps it too, since
that is a reference to the very import being added. With `inject: false` nothing is renamed: the
bindings are yours.

Two consequences worth knowing:

- **Only booleans.** `{0 && <x/>}` still renders `0`, exactly as React does — the rule is about
  booleans, not falsiness.
- **A boolean *inside an array* still renders** — the filter sees the array, not its items, so
  `{rows.map((r) => r.ok && <li/>)}` puts "false" on the page for each failing row. Development
  names each one, and `{rows.filter((r) => r.ok).map(…)}` is the fix. **This is where vera and React
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

Every mistake below is reported with the file, line and column and its code — the full explanation
of a code is at `https://verajs.dev/e/<code>` — not left for the next tool to choke on. **The Vite
plugin and any Node use say the whole sentence**: the package's `node` export condition is the
development build, because a build tool's message is all it can tell you and no page downloads it.
**A buildless page on the `.min.js` loader gets the position and the code**
(`app.jsx:1:15 — https://verajs.dev/e/jsx-tag-mismatch`), because that compiler is fetched by the
page and every page would pay for the sentences; map the development loader while developing to
read them (the buildless recipe in `llms.txt` shows the one-line swap).

- a closing tag that names a different element (`<p>…</b>`) — `jsx-tag-mismatch`
- `key` anywhere but the JSX root returned from a list callback — on an element or a component —
  `jsx-key-placement`
- children inside a void element (`<input>{label}</input>`), which no markup can express: passed
  through, the binding silently left the element it was written inside — `void-children`, the
  renderer's `tag()` refusal too
- `dangerouslySetInnerHTML` in any shape other than `{{ __html: … }}` — `jsx-inner-html-shape`
- `style` given an object — `style-object`, also the renderer's `tag()` refusal
- a sigil with no value (`.rows` on its own) — `jsx-sigil-value`
- braces holding nothing (`x={}`, `{...}`) — `jsx-empty-expression`
- a comment among the attributes that is never closed — `jsx-unclosed-comment`

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

**What the typings do and do not check.** A built-in element's **event handlers are typed**; every
other prop is deliberately permissive. So under `strict`, an inline handler infers its event and
its element, as it does in other TSX setups:

```tsx
<input onInput={(e) => props.onQuery(e.currentTarget.value)} />   // e: InputEvent, currentTarget: HTMLInputElement
<button onClick={(e) => console.log(e.button)}>Go</button>         // e: PointerEvent
<svg onPointerDown={(e) => e.currentTarget.viewBox} />             // SVG and MathML elements too
```

Both `onKeyDown` and `onKeydown` are typed — the compiler lowercases whatever follows `on`, so
every casing binds the same event. A handler may be anything the renderer accepts: a function
(called with the element as `this`), a `{ handleEvent }` object, or `false`/`null`/`undefined`
for none, so `onClick={open && close}` type-checks. An `on…` name the DOM library does not know —
a custom event — gets a plain `Event`, which is what `addEventListener` gives it too; annotate it
(`(e: CustomEvent<Item>) => …`) when you need more. A number or a string where a handler belongs
is an error.

Everything else accepts every prop, so `key={id}` and bare props on a component type-check, and a
dash-named tag (a custom element) is fully permissive. A typed per-attribute surface is the known
long tail. Three consequences worth knowing:

- **A misspelled handler name compiles.** `onClik` becomes a listener for `clik`, an event that never
  fires. TypeScript cannot refuse it beside the permissive props, so the renderer names it instead — in
  development only, once, when the name is a keystroke or two from an event the element really has:
  *"@clik on <button> is not an event <button> fires — did you mean @click?"*. Custom event names,
  including ones that extend a real event (`onChanged`), are left alone.
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
