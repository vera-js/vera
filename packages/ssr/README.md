# @verajs/ssr

Server-side rendering for VeraJS components. Node only, plain ESM, **zero dependencies** — no jsdom,
no parse5, no lit, no acorn. Components render to **declarative shadow DOM**, and the renderer's
`hydration` module (`wire([renderer, hydration])`) adopts that markup in the browser without re-creating it.

**Light-DOM slots** are distributed on the server while `@verajs/renderer/slots` is wired: each filled slot is written
with the two comments the client keeps around it (`<!--[-->` … `<!--]-->`), and the host states its light tree in
`data-vm-light`. A hydrating page reads that through one more module, wired only where both are used:
`wire([renderer, hydration, slots, hydrateSlots])` (`@verajs/renderer/hydrate-slots`). Render and hydrate with
matching releases of `@verajs/ssr` and `@verajs/renderer` — the statement carries a format number, and a page in
another format renders fresh, its content kept.

**Hydrate what this renders: wire `hydration` on the client** (`wire([renderer, hydration])`). Without it the client renders
beside the server's markup — two copies — except a light-slots host, which re-renders once or, holding light content,
stands as served with `hydration-unwired`.

**Wire `slots` on the client AND here:** without it this server writes no light-tree statement, so the client takes
every component it rendered for client-made and renders it fresh — its markup kept, hidden — with no warning possible.

**Serve the HTML unmodified — comments included.** Hydration adopts those slot comments. An HTML minifier that strips
comments removes them, and hydration then treats that component as a mismatch: the standard fallback warning and a
fresh render, as React, Lit and Solid treat a missing marker of theirs.

```js
import { renderToString } from '@verajs/ssr';   // first — it installs the DOM the renderer needs

const { html, styles, title } = await renderToString(new URL('./components/app.js', import.meta.url), {
  attributes: { 'user-id': id },   // an object: names checked, values escaped
  props: { rows },                 // structured data — an attribute can only carry a string
  location: request.url,           // this request's URL, for anything that reads one
});

response.end(`<!doctype html><title>${escape(title)}</title><style>${styles}</style>${html}`);
```

`html` is the component's markup, its shadow root serialized as `<template shadowrootmode>`. `styles`
is the light-DOM CSS for the page's `<style>` (already escaped for that element — see
[Styles](#styles)). `title` is `document.title` as the render left it, which is how a shell names its
page. `examples/ssr-node/server-native.mjs` is a complete server on bare `node:http` serving the whole
round trip, hydration included.

The package is TypeScript, compiled file by file to `dist` (no bundling, no minification), with its `.d.ts` files
beside it for TypeScript consumers.

## Two entry points

| | |
| --- | --- |
| `renderToString(url, options?)` | synchronous end to end; the fastest path, and the right one for most components |
| `renderToStringAsync(url, options?)` | **awaits** the lifecycle — an `async connectedCallback`, and work a frame starts — so a component that loads data, or **a routed app's first view**, is in the first response |

Both take the same options, return the same `{ html, styles, title }`, and share everything that
decides what to emit — scanner, serializer, instance preparation, page assembly.
`tests/ssr-async-parity.test.mjs` renders every fixture through both and compares.

**Use the async one for a router.** `initRouter` works on the server, and the router's first
navigation runs on a frame and awaits its route. `renderToString` serializes before that settles, so it
serves the shell with an empty `[view]` outlet for the client to fill; `renderToStringAsync` waits, and
serves the route the request's `location` names. `renderToString` **refuses** an `async
connectedCallback` rather than serve its empty markup.

**Renders take turns** — one at a time, across both entry points. The per-render bookkeeping is
module-level, so two renders interleaving would read each other's; queueing is the version that
cannot be wrong, costs one microtask when nothing is in flight, and is invisible because every caller
already awaits. A render that throws does not stop the queue.

## Options

| Option | |
| --- | --- |
| `tag` | which element to render when the module defines several. Otherwise the module's exported class is matched against the registry — so **export the class**, or pass `tag` |
| `attributes` | the entry tag's attributes. **An object** — values escaped, names checked. A string is written through untouched (a sink: see [Security](#security)) |
| `props` | properties assigned to the instance before `connectedCallback`, by identity. A `__proto__` key is skipped, and a read-only property is refused by name |
| `children` | markup placed inside the entry tag, where a client parser would have put it — what a `<slot>` renders. **Raw markup** |
| `location` | this request's URL — a path or a full URL — applied for the render and restored after |
| `seen` | a `Set` carried across renders, so a page of islands ships each component's styles once |
| `base` | a directory the module URL must resolve inside. Pass it whenever **any part of the URL came from a request** |
| `static` | `true` for a page that will not be interactive: reactivity is skipped, about 3x faster, identical markup |
| `timeout` | how long `renderToStringAsync` waits on promises a component starts, in milliseconds (default 2000), before serving what it has and warning — see below. **`0` waits for nothing** (it is not "no limit", which this option cannot express): every such promise is abandoned at once |

A wrong type is refused with a `TypeError` naming the option (`children: 5` used to surface as
`markup.includes is not a function`).

**Pass `location`; never assign `globalThis.location` yourself.** The global belongs to the process
and a request does not: the call awaits `import()`, which yields on a module's first import, so
whichever request assigned last wins for every render after it. Measured with three concurrent
first-time imports, two of three rendered another request's path. The option is applied inside the
render's turn and restored in a `finally`. `title` is returned rather than left on the global for the
same reason, and the document's own title is restored afterwards. **Renders take turns**, process-wide: two
calls made together run one after the other, so no render ever sees another's frames, adopted stylesheets or
globals (measured: two `renderToStringAsync` calls started at once finish at 154 ms and 255 ms, the second's
budget starting at its turn).

**No render waits unboundedly on a component's promise.** `renderToStringAsync` awaits what a component starts
— an `async connectedCallback`, a promise a frame callback returns — for at most `timeout` milliseconds (2000 by
default) from the start of its turn. One that never settles, such as a wait on a child the server never defines,
used to hold the request open forever, and because renders take turns, every request after it as well. When the
budget runs out the render serves what it has and warns, in every build, naming the component — once per component
for the life of the process, as every ssr warning is: the page served is not the one its code describes, so raise
`timeout` if the wait is real or find the promise that never settles.
There is deliberately no way to wait without limit: `timeout: 0` means wait for nothing, and the largest value is
2147483647 ms.

**What ssr says, and how.** Every line ends with its code — the full explanation of a code is at
`https://verajs.dev/e/<code>` — and keeps its whole sentence in every build, since a server's log is read by its
developer. Two rules make it safe on a server: **a warning is said once per process per key** (the component, and the
attribute or event where that tells two facts apart), because a server renders per request and a per-render warning
would flood the log at request rate; and **text from outside — an error's message, a URL, a selector — is
JSON-quoted and cut to 80 characters**, so a newline or an escape sequence in it can neither forge nor hide a log line.
A refused `javascript:` URL is reported without its value at all, and data shaped like a template is reported and
rendered as the object it is. The errors the shim throws in the platform's own words (`Failed to execute 'appendChild'
on 'Node'…`) stay exactly those: this is a DOM, and it answers as the browser does.

**A wait on a child only the browser defines costs the whole `timeout`, on every request** — and since renders take
turns, every request queued behind it waits too. The warning names the component waiting and the child it waits on.
Return before that wait on the server:

```js
async connectedCallback() {
  init(this, { mode: 'open' });
  render(() => html`<p>${state.ready ? 'map ready' : 'loading map'}</p><x-map></x-map>`);
  if (globalThis.__veraSsrShimmed) return;   // the server serves the state before the wait
  await customElements.whenDefined('x-map');
  state.ready = true;
}
```

That serves the component's state from before the wait, which is exactly what the browser shows first, so hydrating
changes nothing — and it takes no time and prints no warning. Skipping only the `await`
(`if (!globalThis.__veraSsrShimmed) await …`) serves the state *after* it, which the browser then replaces with its own
starting state: a visible flash. A stand-in class defined on the server does the same.

**`globalThis.__veraSsrShimmed` is the supported way to tell the server render from a browser**, here and for guarding
client wiring: `@verajs/ssr` sets it to `true` when it is imported, before any component runs, and nothing sets it in a
browser. `typeof window` cannot tell them apart, because the server provides a `window`.

## What runs, and when

**The lifecycle runs the way it does in a browser.** The class is constructed through the registry,
the markup's attributes are set, `attributeChangedCallback` fires for each observed one on upgrade and
again on every later change, and then `connectedCallback` runs. `tests/lifecycle-parity.test.mjs`
renders each case on both sides and compares the DOM. What a component does to itself there — a
`setAttribute`, an `aria-*`, a class, a reflected property — reaches the markup.

**Frames are drained before the markup is read.** A server never paints, so `requestAnimationFrame`
(and `requestIdleCallback`) callbacks are queued and run once `connectedCallback` returns, then again
for whatever those schedule — so a re-render and every `useEffect` land in the markup, coalesced
exactly as a browser coalesces them.

- **An endless animation loop is bounded**: 20 rounds, then the render ships. What the loop left
  queued is dropped, never run inside the next component's render.
- **The async chain lets promises settle between rounds.** A frame that returns a promise is awaited,
  whatever it awaits; work a frame starts without returning it is caught if it lands within three idle
  microtask turns (measured: a chain four microtasks deep).
- **`useLayoutEffect` runs on a microtask.** Through `renderToStringAsync` its state reaches the
  markup, as on the client. Through `renderToString` it runs — a side effect inside one *happens* on the
  server — but after the template was serialized, so state it settles is not in the markup: settle it
  before `render()`, or use `renderToStringAsync`.

**A failure rejects the render — it is never markup.** In a browser, core isolates a hook's error so
one bad effect cannot take out its neighbors, because the next render can recover. There is no next
render here, so every failure — a throwing hook or `connectedCallback`, a `settle` handler that
throws — rejects the render, naming the component (and how many more failed), with the original
error as `cause`. Catch it to fall back to a client-rendered shell, as you would with React or Vue.

**`render()` owns its own range and nothing else**, as in a browser: content already in the
container stays before it, a node the component appends to its own root stays after it, and both
survive every re-render. So `children` reach a light-DOM component and are still there after it
renders.

## Nested components

After a component renders, its markup is scanned for tags the registry knows, and each is rendered in
place — **exactly where the browser creates an element the definition upgrades**, read by the same tag scanner
every template goes through. It respects quoted attribute values (a `>` is legal inside one), leaves comments,
raw text (`<script>`, `<style>`, `<textarea>`, `<title>`…) and `<template>` content alone, and renders nothing
inside `<svg>` or `<math>`, where a dashed tag is a foreign element no definition upgrades — except inside an
HTML integration point (`<svg><foreignObject>`, `<math><mtext>`…), or after a tag that breaks out of foreign
content (`<svg><p><my-comp>`), both of which the browser reads as HTML. A tag's name is the whole name the tokenizer
reads, so `<my-comp.x>` is another, unregistered element and is left exactly as written. After `<font color>` inside
`<svg>` (a breakout this scan does not track) a component is not rendered on the server, and renders on the client.

- **A component can build another component.** `document.createElement('my-comp')` constructs the
  registered class — field initializers run, `instanceof` answers — and appending it renders **that
  instance**, so everything the parent assigned (`kid.rows = data`) survives.
- **A property bound on a component tag is delivered**, not dropped: written (`<props-row .item=${row}>`)
  or spread (`props({ item })`), the value reaches the instance the scan renders — by identity, before
  its lifecycle, exactly where the `props` option puts the entry component's. The markup never carries
  it (a property is not an attribute), so the child renders from the same data its client render will
  get: that is the hydration contract. An **unregistered** dashed tag passes through untouched.
- Both ride on a marker attribute that crosses the string boundary and is removed before the page is
  returned. **It only ever produces the component it was written for**: a copy of it on another tag is
  ignored, and a copy on a second element of the same tag renders the instance once, not twice.
- **Nesting is capped at 256 levels, and the client has no such cap.** A component that renders itself
  recurses without bound, which on a server is a hung request, so the render refuses past 256 and says
  so. 256 sits *below* where the client breaks (about 340 levels before a `RangeError`, engine-
  dependent), so the server still fails first, and with a sentence.

## Static pages

`static: true` renders a page that will not be interactive, **about 3x faster** — 16 µs against
42–50 µs for a component rendering twenty rows. A server render is one shot: the subscriptions a store
builds while it runs are never fired afterwards, so tracking every read to create them is the whole of
the cost. With `static` on, a store's property reads skip tracking.

- **The markup is identical**, and not on a chosen example: `tests/ssr-static-mode.test.mjs` renders
  *every* fixture in the suite both ways and compares markup, styles and title. A mode that cannot
  drift is why this is an option rather than a second renderer.
- **A store written during a static render throws**, naming the option, rather than serving markup
  that reflects none of the writes. In both builds — a server runs the production build, so a
  development-only guard would be missing from the only place it matters.
- It applies to the render, not to the process: a render queued behind a static one, and any store
  written outside a render, are reactive as ever.

It is `@verajs/ssr`'s own `'store'` insert — core knows nothing about it.

## Security

**Escaping happens at the render boundary, always.** Every interpolated value in a template is
escaped as it is written; `<style>` and `<script>` content is written raw with its own end tag
neutralized (`<\/style`, `<\/script` — valid CSS and JavaScript, invisible to the tokenizer), because a
browser does not decode a character reference inside either: escaping there protects nothing and
corrupts the content (`.a > .b` used to serve as `.a &#62; .b`, a selector matching nothing).
`<title>` and `<textarea>` decode references, so they keep ordinary escaping. **The same rule holds for content
a component writes through the server DOM**: `textContent`, `value`, `innerHTML` or a text node in any of those
elements is stored as text and written by its parent's rule, so data can never close the element it is in. **Raw is decided by where
the browser will parse the element, not by its name**: inside `<svg>` or `<math>` a `<style>` is an SVG or
MathML element whose content is markup, and `<noscript>` is markup to a browser with scripting off — so
inside any of them every value is escaped, and so is every value in a template rendered into one (an
`svg`/`mathml` template included, wherever it renders) — except inside an HTML integration point, which the
browser reads as HTML: SVG `<foreignObject>`, `<desc>` and `<title>`, MathML `<mi>`, `<mo>`, `<mn>`, `<ms>` and
`<mtext>`, and an `<annotation-xml>` whose `encoding` is HTML, each only in its own namespace and only when not
self-closed (`<math><mi><mglyph>` is MathML again) — and after a tag that ENDS foreign content, which the browser
reads as HTML again (`<svg><p>`, `<math><b>`, `</p>`; the standard's breakout list). Inside `<xmp>`, `<noembed>`, `<noframes>` and
`<plaintext>`, which the browser reads as text whole, nothing is raw either. **And a tag is read where the
browser's tokenizer reads one**: a tag's name is the whole run up to whitespace, `/` or `>` (`<script.x>` is an
unknown element, never a `<script>`), a `<` before anything but a letter is text, `<!x>` and `<?x>` are comments,
and a quote or `=` inside a name is part of the name.

**Two options are raw markup, on purpose: `children`, and the string form of `attributes`.** Both are
written through untouched — that is what they are for — so neither may carry anything from a request
unsanitized. Everything else is checked:

- **The object form of `attributes` cannot leave the tag or add a second attribute.** A name carrying
  whitespace, a quote, `/`, `=` or `>` is refused — the set `setAttribute` refuses in a browser — and
  every value is escaped. `false`, `null` and `undefined` omit the attribute; `true` writes it empty (`name=""`).
- **`.innerHTML` and `.textContent` render on the server**, so trusted markup bound the sanctioned way
  (`<div .innerHTML=${markup}>`) is in the served page rather than filled in after hydration. It is made to behave
  as an `innerHTML` assignment, not as parsed page markup: a `<script>` in it is served with an inert `type` (an
  assignment never runs one), and a `<template shadowrootmode>` cannot attach a shadow root (an assignment never
  does) — wherever the tokenizer reads a start tag, which the server finds with the same scanner it reads every
  template with. Whatever the markup leaves open is closed before the element's own end tag, and an unfinished tag
  at its end is dropped, as an assignment drops it, so it cannot reach the markup after it. On a `<style>`/`<script>` host the value is raw text with its end tag neutralized; on a
  `<textarea>`, `<title>` or other text-only host, inside `<svg>`/`<math>`, and for any `.textContent`, it is
  escaped text. A `<script .textContent=${code}>` host is the one code-execution door this opens, and it is the
  author's: it runs on the served page as it runs on the client. `.innerText`, `.outerHTML` and `.outerText` stay
  client-only — the server serves the element's template content.
- **Data shaped like a template is text.** A value renders as markup only when its strings came from a tagged
  template literal; a `{"strings": [...]}` from `JSON.parse` — or a real template sent through JSON, or a
  hand-built `html([markup])` — is served as `[object Object]`, as the client renders it, and never throws.
- **A `__proto__` key in `props` is skipped**, so handing the option a parsed request body cannot
  replace the component's prototype.
- **Every bound attribute value is served double-quoted, whatever quoting the template used.** A value
  shares its attribute with any statics and other holes around it — `title=pre${x}`, `title=${a}${b}`,
  `title = ${x}`, single or double quotes — and the server writes that whole attribute once, the way the
  client's `setAttribute` stores it, so nothing a value holds can end the attribute or start another.
  A hole that is the whole value omits the attribute for `null` and `undefined`, as the client does; a
  hole joined with statics contributes empty text.
- **A bound `javascript:` URL is never served.** A template value bound where a browser navigates
  (`href`, `src`, `action`, `formaction`, `xlink:href`, `data`, and an SVG animation's `to`, `from`,
  `by` and `values`, item by item) is dropped when it parses as a `javascript:` URL — judged on the attribute's whole value, statics and character references
  included, as the browser will read it — and a bound `srcdoc` attribute is never served. The client
  renderer refuses exactly the same values, so the two agree.
- **`base` contains the module URL.** `renderToString` executes the module it is given, and mapping
  a route to a component file is the obvious way to use a server renderer — so pass `base` whenever
  any part of the URL came from a request:

  ```js
  renderToString(new URL(`${page}.js`, components), { base: components });
  ```

  Anything resolving outside it is refused. `new URL` applies `../` before `renderToString` sees the
  string, so without this the traversal has already happened by the time the call is made. It is
  opt-in because most calls name a constant, and a check that is always trivially satisfied stops
  being read.
- **`styles` comes back escaped for a `<style>` element**, since that is where a page shell puts it.
- **A dynamic attribute *name* is refused** — by the server in every build, and by the client renderer in
  development. `<b ${name}="x">`, `<p data-${k}="1">`, `<p ${k}-x>`: the parser reads a name before any
  value exists, so no position can hold it. Both throw at the template's first use, and the message shows
  the `@verajs/renderer/spread` rewrite — `${spread({ [`data-${k}`]: '1' })}` — which applies the refusals
  a runtime name needs. The same holds for a value in TAG position (`<${x}>`, `<my-${x}>`), which names
  `@verajs/renderer/tag` — a runtime tag name is a tag value from that entry. The server refuses in production too, so a production server render of such a
  template throws even though the client's production build would not — render it once in development
  and it never gets that far.
- **A template ending inside a tag is refused** (`<b title="${x}` with no `>`), and so is **a template rendered
  inside a text-only element** (`<textarea>`, `<title>`, …): both on the server in every build, the first also by
  the client renderer in development. The client's parser drops an unfinished tag whole, so nothing can match it,
  and a template's markup inside a text-only element is the one way a value could close that element. Strings,
  numbers and arrays of them render in a `<textarea>` as always.

## Styles

`@verajs/styles` is wired on import, because `static styles` are part of what a browser renders.

- **Shadow DOM:** markup cannot carry a constructed sheet, so a component's styles are serialized as
  `<style data-vm-sheet="styles">` inside its template — plain strings first, then sheets, which is the
  order the browser's cascade applies them in (adopted sheets win over a root's own `<style>`). When
  every style is a sheet the client can adopt, it removes that copy, so the rules never apply twice.
- **Light DOM:** a component's `@scope (tag) { … }` block is returned in `styles` for the page shell,
  **only for the components this render touched**, and — with a shared `seen` — once across a page of
  islands.
- **A tag's CSS is established once per process**: whichever render reaches it first sets it. That is
  what stops a per-class sheet being emitted once per instance; the consequence is that CSS varying
  per request is dropped, with a warning — once, naming the component. Put what varies in
  custom properties (see the `@verajs/styles` README).

## The server DOM

Importing `@verajs/ssr` installs a DOM on `globalThis`: `document`, `window`, `customElements`,
`HTMLElement` and the rest, **replacing** any already there.

- **Import it first**, before anything that imports `@verajs/renderer`, which builds `TreeWalker`s at
  import time and throws against a bare Node global. Core, `@verajs/styles` and `@verajs/router` are
  order-independent.
- **Run any other DOM in another process.** jsdom in a test loses its globals the
  moment this module loads, however late, and a component defined afterwards is never upgraded — with
  nothing saying why. This repository's own tests render the server half in a subprocess for exactly
  this reason.
- **A client renderer wired after this import is refused** — it would displace the server's and every
  component would render empty. Guard the client wiring (`if (!globalThis.__veraSsrShimmed)`), or keep it
  out of the modules the server imports.

**It is complete, and checked twice.** Every member a real element, shadow root, document,
`CSSStyleSheet`, `DOMTokenList` or window exposes in Chromium, Firefox and WebKit is either
implemented or listed as out of scope with a reason — and every implemented member is compared against
a real DOM, so one that exists and answers differently fails too. That second check found `tabIndex`
defaulting to 0, `draggable` defaulting to true, `role` answering `''` where the platform answers
`null`, `textContent = null` writing the word "null", and a closed shadow root handed straight back. It
compares a member's *shape*, not its answer to every input, so it is a net rather than a proof — three
classes of defect were found by going around it deliberately. The window's ~700 interface constructors
are covered by a rule rather than a list (every interface this DOM implements is exposed, so
`instanceof` answers for anything it hands you); `tests/dom-surface.mjs` holds the list, with no
dependency involved.

- **Element-specific properties reach the markup.** `input.disabled`, `a.href`, `td.colSpan`,
  `option.selected` — 273 of them across 44 tags, measured from the three engines
  (`scripts/measure-element-reflections.mjs`), each tag getting exactly its own interface, so
  `'disabled' in paragraph` stays `false`. Without this, `button.disabled = true` stored a plain
  property and **served a button that was not disabled** until the bundle landed. A property is in the
  table only when all three engines agree and reading the attribute back gives what was written, which
  excludes ones resolved against a document URL (`form.action`), read from layout (`input.width`) or
  clamped (`meter.value`). `value`, `checked` and `selected` are mirrored to the markup deliberately:
  a browser keeps them off it, but on a server the markup is the whole output.
- **Events are real and propagate** — capture, target and bubble phases, `once`, `handleEvent`
  objects, `stopPropagation`, `stopImmediatePropagation`, `composedPath()`, a `dispatchEvent` return
  reflecting `preventDefault`, and a shadow boundary crossed only by a `composed` event. The walk is
  over the node tree, so an event does not continue into `document` or `window`.
- **Where the platform throws, this throws** — an attribute or tag name that cannot be written, a
  second `attachShadow` or `attachInternals`, an invalid custom-element name, and every Node-typed
  argument that is not a node (`appendChild({})`, `removeChild(null)`, `contains({})`), with the
  platform's `TypeError`. `new HTMLElement()`, `new Node()` and `new X()` for a class never defined are
  an `Illegal constructor`, as they are in a browser. Lenience on a server does not make anything work;
  it moves the failure to the client and strips the context.
- **The Node interfaces are the platform's.** A text node is a `Node`, a `CharacterData` and a `Text`;
  `Node`'s constants are on every node; `append({})` inserts the text `[object Object]`, as the
  `(Node or DOMString)` union converts; and `String(node)` names its interface (`[object Text]`) — for
  text, comments, fragments and shadow roots. An element's name depends on its tag and is not yet
  answered (`[object Node]` here, `[object HTMLDivElement]` in a browser).
- **A selector this DOM cannot answer honestly throws** rather than answering `null`. It matches type,
  class, id, every attribute operator, `:not()` and all four combinators — descendant, `>`, `+` and
  `~`. Everything else raises, for **two different reasons**: `:hover`, `:checked`, `:visible` and
  `:root` need user state, layout or a document a server does not have, while `:first-child`,
  `:nth-child()`, `:empty`, `:first-of-type`, `:is()` and `:has()` are answerable here and simply are
  not implemented.
- **Names fold as the platform folds them**: an HTML element lower-cases its tag and attribute names,
  so an `attributes` entry spelled `User-ID` matches an `observedAttributes` entry `user-id`; an
  element from `createElementNS` outside the HTML namespace keeps its case, so an SVG `viewBox`
  survives.
- `attachShadow({ mode: 'closed' })` gives `element.shadowRoot === null`, as in a browser, and the root
  is serialized anyway — declarative shadow DOM expresses `closed`. `attachInternals()` works, so a
  form-associated custom element runs.
- The globals a component reaches for exist: `matchMedia` (matching nothing), `getComputedStyle`
  (empty, as a detached element answers), `IntersectionObserver`, `ResizeObserver`,
  `MutationObserver` and `PerformanceObserver` (inert, but constructing one does not throw).
- **`localStorage`, `sessionStorage`, `indexedDB` and `caches` are deliberately absent.** They are one
  browser's state; a server that invented an empty one would render a logged-out shell the client
  immediately replaces, with nothing failing anywhere. `typeof localStorage === 'undefined'` is the
  guard the ecosystem already writes, and it only works if this does not lie.

**Where it deliberately differs:**

- **A collection is a plain array**, not a live `NodeList` — `childNodes`, `children`,
  `querySelectorAll`, the `getElementsBy*` family. There is nothing to be live over in a single pass;
  `item()` and `namedItem()` are provided anyway.
- **A parsed `<template>`'s content is opaque**, and `template.content` is `undefined`. The element is
  modeled — queried, styled, serialized byte for byte — and a query on the host correctly does not
  descend into it; reaching *into* one is what is missing.
- **A constructed sheet holds its CSS as text**, so `cssRules` is empty and `deleteRule` refuses
  rather than pretends. `checkVisibility()` is always `false` and layout reads as zero, as for a
  detached element in a browser. A `style` value is kept as written (`url("data:…")` keeps its quotes).
- `insertAdjacentHTML` with `beforebegin` or `afterend` raises a message explaining that a
  server-rendered component has no parent.
- **A created or parsed `<pre>`, `<listing>` or `<textarea>` whose text begins with a line feed reads back with
  one extra line feed from `innerHTML`/`outerHTML`.** The parser takes one line feed right after those start tags,
  and a browser's own serialization does not account for it — Chromium, Firefox and WebKit serialize the text
  `"\nabc"` as `<pre>\nabc</pre>`, which parses back as `"abc"`. This DOM's serialization is what the server sends,
  so it writes the one the parser will take; templates and `.textContent`/`.value`/`.innerHTML` bindings do the same.

**Values read back are the platform's.** A parsed node's text, attribute and comment values are what a browser's
parser makes of the markup: line breaks normalized (CRLF and CR read as LF; a `&#13;` reference stays a CR),
`<textarea>` and `<title>` content decoded, and the line feed after `<pre>`/`<listing>`/`<textarea>` taken. The
markup itself is served byte for byte as it was written.

## What cannot round-trip

- **A binding inside a nested `<template>`'s content is ignored, on the server and the client alike.**
  That content is inert markup the renderer never walks, so a value there is never rendered and an
  attribute holding one is dropped whole; a binding on the `<template>` element itself is ordinary.
  Render into the live tree instead.
- **A `<select>`'s value is served as `<option selected>`** — assigning the property *selects an
  option*, so that is all markup can say, and `.selectedIndex` is served the same way by position. Matching follows the platform (the `value` attribute
  verbatim, otherwise the option's text stripped and collapsed; first match wins), asserted against
  Chromium, Firefox and WebKit in `tests/browser/select-value.test.js`. But a value matching no option cannot be served:
  the client leaves nothing selected, while a parsed `<select>` with no `selected` option shows its
  first, and there is no markup for "none of them". An index out of range, `-1` included, is the same case.
- **A carriage return survives, as `&#13;`** — the HTML parser collapses a raw CR before tokenizing,
  so escaping it is what keeps a `<textarea>` value or a CSV cell identical on both sides.
  **RAWTEXT is the exception, and it is not fixable**: inside `<style>` and `<script>` a reference is
  not decoded, so there is no spelling of a CR that survives there. CR and LF are interchangeable
  whitespace to CSS and JavaScript, so nothing renders wrongly — the two sides simply hold different
  strings. Asserted in `tests/browser/rawtext-carriage-return.test.js`.
- **A `<style>` or `<script>` the server cannot place in HTML is served escaped.** Raw text is recognized
  outside `<svg>`, `<math>` and `<noscript>`, inside their HTML integration points (`<svg><foreignObject>`,
  `<math><mi>`…) and after a breakout tag (`<svg><p>`), but the scanner does not track the remaining ways a browser
  re-enters HTML: `<font>` with a `color`, `face` or `size` attribute (it breaks out; here it never does), an end tag
  the parser ignores, an `svg` template rendered outside any `<svg>`, and a template rendered INTO a foreign position
  by its parent — it knows the depth it starts at, not whether that is
  SVG or MathML, so it recognizes no integration point (`html`<svg>${svg`<foreignObject><style>…`}</svg>``). There
  the browser reads HTML raw text, so a `>` in the stylesheet arrives as `&#62;` until hydration replaces it. That is
  the safe direction of a misreading on purpose: the other one writes a value's markup into the page. Put the
  stylesheet in the template that opens the foreign element, or outside it.
- **`.innerHTML` markup is parsed in place on the server and as a fragment on the client.** The client parses
  the value with the element as its context; the served page is parsed with every real ancestor around it, so a
  few shapes nest differently on first paint — a `<p>` inside a `<p .innerHTML>` (the page closes the outer one),
  an `<a>` inside an `<a>`, table parts outside a table. Hydration re-assigns the value, so the client's DOM is
  right once the script runs; an inline handler in the markup (`onload`, `onerror`) therefore fires twice on an SSR
  page, once from the served HTML and once from the assignment. Inside `<svg>`/`<math>` the server writes the
  value as escaped text, the safe side of the same misreading, until hydration assigns it.
- **An ordinary element a template leaves open nests differently.** The client parses each template on its own
  and closes what it left open at its end; the server concatenates. Whatever changes how the rest of the page
  PARSES is closed at the template's end on the server too — a comment, `<style>`/`<script>`, `<textarea>` and the
  other text-only elements, `<svg>`, `<math>`, `<noscript>`, `<template>` — so a child can never reach its
  parent's markup. A plain `<b>` or `<div>` left open is not closed, so the parent's next markup nests inside it
  on the server and beside it on the client. Close every element inside the template that opens it.
- **Beyond that, three things cannot survive a server round trip, and are the only three**: that carriage return
  inside `<style>`/`<script>`, and two characters. **NUL** is dropped in text and becomes U+FFFD in an
  attribute or RAWTEXT, and no spelling round-trips, so it is left alone rather than silently
  rewritten. **A lone surrogate** is not encodable in UTF-8, so the *transport* replaces it. Both are
  covered by `tests/ssr-text-boundary.test.mjs`, alongside twenty-odd cases that do round-trip exactly.

## Known limits

- **A parsed node decodes six named references**: `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;` and `&nbsp;`, and
  every numeric one. Any other (`&copy;`, `&mdash;`, a legacy `&amp` with no `;`) reads back as written in that node's
  `textContent` and attributes. The markup is served unchanged, so the page is right; only what a server component
  READS from such markup differs.

- `keyed()` and `hold()` are client-renderer constructs; templates that must also server-render use
  plain `.map`.
- **`slotAssignment: 'manual'` cannot be server-rendered**: declarative shadow DOM has no form for it,
  and `attachShadow` ignores its options when it reuses a declarative root, so the client cannot
  repair it. `mode`, `delegatesFocus`, `clonable` and `serializable` are all serialized.
- A function interpolated at a text position renders as nothing here and as its source on the
  client — put functions in `@event` bindings, where both sides drop them.
- **No streaming.** `renderToString` returns a string where `@lit-labs/ssr` yields a stream. That buys
  time-to-first-byte in proportion to how long a render takes, and a 100-row table here is PERF_TABLE µs
  — the response is built before a stream would flush its first chunk. Worth revisiting for a page big
  enough that it stops being true.

## Performance

`node bench/ssr.mjs` (fastest of 7 rotated rounds; run `cd bench && npm install` first), µs per render
— a small component, and a 100-row table:

| | small | table |
| --- | --- | --- |
| **template serialization** — `serializeTemplate` vs `@lit-labs/ssr` | **PERF** | **PERF** |
| | lit PERF | lit PERF |
| **whole component** — `renderToString` vs a real `LitElement` | **PERF** | **PERF** |
| | lit PERF | lit PERF |

Vue's compiled SSR is PERF / PERF µs and React PERF / PERF µs, neither of which renders a component.
The lit element row runs in a separate process: `@lit-labs/ssr` and this package both install DOM
globals and cannot share one.

## Also exported

`registry` — the `Map` of tag → class this process has seen through `customElements.define` — and
`serializeTemplate`, the sigil-aware template flattener (one template to markup, no component scan),
are the two seams an advanced integration reaches for: a custom scanner, a fixture builder.

```js
import { registry, serializeTemplate } from '@verajs/ssr';
registry.has('app-shell');                             // true once the component's module has run
const fragment = serializeTemplate(html`<p>${x}</p>`); // '<p>…</p>', every value escaped
```

## For AI assistants — and anyone who wants the whole API on one page

The repository root's [`llms.txt`](../../llms.txt) is the complete, hand-maintained API
reference for every package, written to be pasted into a model's context window: full export
tables, the buildless CDN and JSX recipes, semantics that differ from other frameworks, and the
mistakes that come up most. Its recipes are executed by the test suite, so they stay honest.
