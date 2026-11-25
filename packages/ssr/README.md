# @verajs/ssr

Server-side rendering for VeraJS components. Node or a Web Worker, plain ESM, **no third-party dependencies**
(only its Vera peers, `@verajs/core` and `@verajs/styles`) — no jsdom, no parse5, no lit, no acorn. Components
render to **declarative shadow DOM**, and the renderer's `hydration` module (`wire([renderer, hydration])`) adopts
that markup in the browser without re-creating it.

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

/** A `<title>`'s text: `&` and `<` are all it needs escaped. (Node's global `escape` percent-encodes; it is not this.) */
const text = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
response.end(`<!doctype html><title>${text(title)}</title><style>${styles}</style>${html}`);
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
| `attributes` | the entry tag's attributes. **An object** — values escaped, names checked. A string is served as attribute text, every attribute in it included (a sink: see [Security](#security)) |
| `props` | properties assigned to the instance before `connectedCallback`, by identity. A `__proto__` key is skipped, and a read-only property is refused by name |
| `children` | markup placed inside the entry tag, where a client parser would have put it — what a `<slot>` renders. **Raw markup** |
| `location` | this request's URL — a path or a full URL — applied for the render and restored after |
| `seen` | a `Set` carried across renders, so a page of islands ships each component's styles once |
| `base` | a directory the module URL must resolve inside, as a URL (`pathToFileURL(dir)` for one on disk). Pass it whenever **any part of the URL came from a request** |
| `static` | `true` for a page that will not be interactive: a store's reads skip tracking, identical markup; faster in proportion to the tracked reads a render makes (see [Static pages](#static-pages)) |
| `timeout` | how long `renderToStringAsync` waits on promises a component starts, in milliseconds (default 2000), before serving what it has and warning — see below. **`0` waits for nothing** (it is not "no limit", which this option cannot express): every such promise is abandoned at once |

A wrong type is refused with a `TypeError` naming the option (`children: 5` used to surface as
`markup.includes is not a function`), and so is a name that is not an option (`timeOut`, `prop`), which used to
configure nothing and say nothing (`ssr-option-unknown`).

**Pass `location`; never assign `globalThis.location` yourself.** The global belongs to the process
and a request does not: the call awaits `import()`, which yields on a module's first import, so
whichever request assigned last wins for every render after it. Measured with three concurrent
first-time imports, two of three rendered another request's path. The option is applied inside the
render's turn and restored in a `finally`. `title` is returned rather than left on the global for the
same reason, and the document's own title is restored afterwards, with the rest of what every render shares: the
`<html>` and `<body>` elements and their attributes (`lang`, a flag on the body), and `document.cookie`, which reads `undefined` until a render
writes it (a server has no user's cookies). What a page's module sets at its top stays, as its own state does; what work a render left running writes
after the render ended is refused. **Renders take turns**, process-wide: two
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
2147483647 ms. What a served-at-its-budget render left running still resolves later, but it cannot touch the next
render: a `document.title` it writes or a frame it requests then is dropped, silently (that render's `ssr-timeout`
warning already named the component), so each page keeps its own title. That takes Node's `AsyncLocalStorage`; where
the runtime has none (a browser Web Worker, Node before 20.16), the package renders as before, without the guard.

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
Don't make the setup wait for it — write the result into state when it arrives:

```js
connectedCallback() {
  init({ host: this, shadow: 'open' }, () => {
    const state = createStore({ ready: false });
    customElements.whenDefined('x-map').then(() => (state.ready = true));   // not awaited: the server serves 'loading map'
    return () => html`<p>${state.ready ? 'map ready' : 'loading map'}</p><x-map></x-map>`;
  });
}
```

That serves the component's state from before the wait, which is exactly what the browser shows first, so hydrating
changes nothing — and it takes no time and prints no warning. Skipping only the `await`
(`if (!isServer()) await …`) serves the state *after* it, which the browser then replaces with its own
starting state: a visible flash. A stand-in class defined on the server does the same.

**`isServer()` from `@verajs/core` is the supported way to tell the server render from a browser**, here and for
guarding client wiring and per-user state: `@verajs/ssr` sets its flag when it is imported, nothing sets it in a
browser, and `isServer()` reads it when called — so it answers the same whichever module was imported first. `typeof window` cannot tell them apart, because the server provides a `window`,
and `typeof localStorage` cannot either on Node 26 (see below). `globalThis.__veraSsrShimmed` is still set, for
`@verajs/renderer` 0.3.1 and earlier; test `isServer()`.

## What runs, and when

**The lifecycle runs the way it does in a browser.** The class is constructed through the registry,
the markup's attributes are set, `attributeChangedCallback` fires for each observed one on upgrade and
again on every later change, and then `connectedCallback` runs. `tests/lifecycle-parity.test.mjs`
renders each case on both sides and compares the DOM. What a component does to itself there — a
`setAttribute`, an `aria-*`, a class, a reflected property — reaches the markup.

**Frames are drained before the markup is read.** A server never paints, so `requestAnimationFrame`
(and `requestIdleCallback`) callbacks are queued and run once `connectedCallback` returns, then again
for whatever those schedule — so a re-render and every `effect` land in the markup, coalesced
exactly as a browser coalesces them.

- **An endless animation loop is bounded**: 20 rounds, then the render ships. What the loop left
  queued is dropped, never run inside the next component's render.
- **The async chain lets promises settle between rounds.** A frame that returns a promise is awaited,
  whatever it awaits; work a frame starts without returning it is caught if it lands within three idle
  microtask turns (measured: a chain four microtasks deep).
- **A `'layout'` effect's state reaches the markup through both chains**, as on the client: each round of
  the drain runs core's queued work first, so `renderToString` serializes the same settled markup as
  `renderToStringAsync`.

**Generated ids restart at each render.** Hooks that give elements ids (`@vera-hooks/labeled` first) count through
one counter every copy of the library shares, which in a server lives as long as the process: the same page served
`vu1…` to one request and `vu4…` to the next. Each render now starts it from 0, so a page's markup is the same on
every request (cacheable, a stable ETag). Ids are unique within a render, so render a page in one call: two renders
assembled into one page can repeat an id.

**A failure rejects the render — it is never markup.** In a browser, core isolates a hook's error so
one bad effect cannot take out its neighbors, because the next render can recover. There is no next
render here, so every failure — a throwing hook or `connectedCallback`, a `settle` handler that
throws — rejects the render, naming the component (and how many more failed), with the original
error as `cause`. Catch it to fall back to a client-rendered shell, as you would with React or Vue.

**A component's render owns its own range and nothing else**, as in a browser: content already in the
container stays before it, a node the component appends to its own root stays after it, and both
survive every re-render. So `children` reach a light-DOM component and are still there after it
renders.

**The page is written top-down, in one pass.** A component's markup is written before its children
are built, so a write a descendant makes during its own setup to state an ancestor rendered (a shared
`signal()`, a store) is in the descendant's markup and not the ancestor's. In a browser the ancestor
re-renders on that write, so the served page changes once it runs there. Settle shared state before
the ancestor renders: in its setup, or before `renderToString`.

## Nested components

After a component renders, its markup is scanned for tags the registry knows, and each is rendered in
place — **exactly where the browser creates an element the definition upgrades**, read by the same tag scanner
every template goes through. It respects quoted attribute values (a `>` is legal inside one), leaves comments,
raw text (`<script>`, `<style>`, `<textarea>`, `<title>`…) and `<template>` content alone, and renders nothing
inside `<svg>` or `<math>`, where a dashed tag is a foreign element no definition upgrades — except inside an
HTML integration point (`<svg><foreignObject>`, `<math><mtext>`…), or after a tag that breaks out of foreign
content (`<svg><p><my-comp>`), both of which the browser reads as HTML. A tag's name is the whole name the tokenizer
reads, so `<my-comp.x>` is another, unregistered element and is left exactly as written. A `<font>` with a static
`color`, `face` or `size` breaks out too (`<svg><font color=red><my-comp>` renders it). One case differs from the
client: after a *bound* one (`<font color=${c}>`) the server renders the component, as the browser reads the served
page, while the client's template never sees the attribute and leaves it a foreign element.

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
  ignored, and a copy on a second element of the same tag renders the instance once, not twice. Code
  reading the DOM never sees it: `getAttributeNames()`, `attributes`, `hasAttributes()`, `innerHTML`
  and `outerHTML` answer as a browser's element does, which has no such attribute.
- **Nesting is capped at 256 levels, and the client has no such cap.** A component that renders itself
  recurses without bound, which on a server is a hung request, so the render refuses past 256 and says
  so. 256 sits *below* where the client breaks (about 340 levels before a `RangeError`, engine-
  dependent), so the server still fails first, and with a sentence.

## Static pages

`static: true` renders a page that will not be interactive, faster in proportion to the store reads it tracks. A
server render is one shot: the subscriptions a store builds while it runs are never fired afterwards, so tracking each
read to create them is cost with no use. With `static` on, a store's property reads skip tracking. On
`bench/ssr.mjs`'s 100-row table with its rows in a `createStore`, whose render reads 300 store properties (`row.id`
twice and `row.label` once per row), it is 47.1 against 118.6 µs, fastest of 7 rounds: 2.5 times faster (medians 47.9
against 127.5). Where a render tracks little there is little to skip: the small component, reading 4 store properties,
is 2.2 against 2.4 µs (medians equal, 3.1), and the same table with its rows in one signal 44.8 against 45.2. All from
one run, the one in [Performance](#performance).

- **The markup is identical**, and not on a chosen example: `tests/ssr-static-mode.test.mjs` renders
  *every* fixture in the suite both ways and compares markup, styles and title. A mode that cannot
  drift is why this is an option rather than a second renderer.
- **A write to a store's own properties during a static render throws**, naming the option, rather
  than serving markup that reflects none of the writes. In both builds — a server runs the production
  build, so a development-only guard would be missing from the only place it matters.
- **A write below them is not caught**: `state.list.push(x)` or `state.user.name = 'x'` changes that
  object for good and renders nothing, and in a store that outlives the request (one at module level)
  the next request sees it. Static reads skip the store's proxy to be fast, so a nested object comes
  back as itself; catching a write there would put a trap on every nested read, which measured +85%
  on the 100-row store table above, most of what static saves. Write state before the render.
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

**Two options are raw markup, on purpose: `children`, and the string form of `attributes`.** `children` is
written through untouched; the `attributes` string is read as the tag's attribute text, so it cannot close the tag
(`"><img>` stays inside it) but every attribute in it is served, an `onclick` included. That is what they are for, so
neither may carry anything from a request unsanitized. Everything else is checked:

- **The object form of `attributes` cannot leave the tag or add a second attribute.** A name carrying
  whitespace, a quote, a backtick, `<`, `/`, `=`, `>` or a control character is refused — the rule a spread's keys
  follow, client and server, stricter than `setAttribute` (which takes a quote or `<`) — and every value is escaped. `false`, `null` and `undefined` omit the attribute; `true` writes it empty (`name=""`).
  An `on…` name (`onclick`, `onClick`) is refused too (`ssr-attribute-handler`): its value would run as code, and
  a value bound into one in a template is dropped for the same reason. Write the handler in the component.
- **`.innerHTML` and `.textContent` render on the server**, so trusted markup bound the sanctioned way
  (`<div .innerHTML=${markup}>`) is in the served page rather than filled in after hydration. It is made to behave
  as an `innerHTML` assignment, not as parsed page markup: a `<script>` in it is served with an inert `type` (an
  assignment never runs one), and a `<template shadowrootmode>` cannot attach a shadow root (an assignment never
  does) — wherever the tokenizer reads a start tag, which the server finds with the same scanner it reads every
  template with. Whatever the markup leaves open is closed before the element's own end tag, and an unfinished tag
  at its end is dropped, as an assignment drops it, so it cannot reach the markup after it. On a `<style>` host the value is raw text with its end tag neutralized; on a
  `<textarea>`, `<title>` or other text-only host, inside `<svg>`/`<math>`, on or inside a `<select>`, and for any `.textContent`, it is
  escaped text. A `<script>` — a JSON data block's too, HTML or SVG — takes no property binding (`.` or `!`): none is
  served, as the client writes none, and the server says so once, in every build (`script-property`; a `.src` is the
  client's `script-source`; a bound `<base href>` is never served either, the client's `base-href`, since every later
  relative and path-absolute script URL resolves against it). A script's content is code, so a value enters a script only as a JSON data block's text
  hole. `.innerText`, `.outerHTML` and `.outerText` stay client-only — the server serves the element's template
  content.
- **Data shaped like a template is text.** A value renders as markup only when its strings came from a tagged
  template literal; a `{"strings": [...]}` from `JSON.parse` — or a real template sent through JSON, or a
  hand-built `html([markup])` — is served as `[object Object]`, as the client renders it, and never throws.
- **A `__proto__` key in `props` is skipped**, so the option cannot replace the component's prototype. Every
  other key is assigned as the platform assigns `el.x = v`, so a key such as `constructor` or `connectedCallback`
  shadows the class's own member: `props` is trusted data, never a request body passed wholesale.
- **Every bound attribute value is served double-quoted, whatever quoting the template used.** A value
  shares its attribute with any statics and other holes around it — `title=pre${x}`, `title=${a}${b}`,
  `title = ${x}`, single or double quotes — and the server writes that whole attribute once, the way the
  client's `setAttribute` stores it, so nothing a value holds can end the attribute or start another.
  A hole that is the whole value omits the attribute for `null` and `undefined`, as the client does — an
  earlier static write of the same name included (`<a title=x title=${null}>` serves `<a>`); a hole joined
  with statics contributes empty text.
- **A sigil binding is read by its attribute's name, whatever its value holds.** `@click="x${fn}"` and
  `&="x${r}"` are still the binding (the client ignores their statics), so nothing is written for them. A
  `?bool`, `.prop` or `!live` value with statics or several holes is one string, joined as the client joins
  it — statics decoded, a nullish hole as empty text: `?hidden="x${false}"` is the truthy `"xfalse"`, and
  `.value="${first} ${last}"` serves the whole name as the control's value.
- **A bound `javascript:` URL is never served.** A template value bound where a browser navigates
  (`href`, `src`, `action`, `formaction`, `xlink:href`, `data`, and an SVG animation's `to`, `from`,
  `by` and `values`, item by item) is dropped when it parses as a `javascript:` URL — judged on the attribute's whole value, statics and character references
  included, as the browser will read it — and a bound `srcdoc` attribute, or a bound URL on a `<script>` (`src`; an
  SVG script's `href`), from a template or a spread, is never served. The client
  renderer refuses exactly the same values, so the two agree.
- **`base` contains the module URL.** `renderToString` executes the module it is given, and mapping
  a route to a component file is the obvious way to use a server renderer — so pass `base` whenever
  any part of the URL came from a request:

  ```js
  renderToString(new URL(`${page}.js`, components), { base: components });
  ```

  Anything resolving outside it is refused. `new URL` applies `../` before `renderToString` sees the
  string, so without this the traversal has already happened by the time the call is made. A URL
  given as a string is resolved first, as `import()` will resolve it, so a `../` or `%2e%2e` after the
  base is read where it leads, and the URL checked is the URL imported; a bare specifier is refused. The
  bound is on URLs: a symlink inside the base that points elsewhere is your layout, and is followed. It is
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
  every style is a sheet the client can adopt, it removes that copy, so the rules never apply twice. A
  `<style>` a component appends to its own shadow root is served the same way, in order, with its
  attributes (`media`, `nonce`, …).
- **Light DOM:** a component's `@scope (tag) { … }` block is returned in `styles` for the page shell,
  **only for the components this render touched**, and — with a shared `seen` — once across a page of
  islands. An instance inside a served declarative shadow root gets the block in THAT root instead (the
  page's sheets stop at the boundary), once per class per root and in every render (`seen` governs the
  page's styles only); a light child slotted into a shadow host sits in the page's light DOM, so its block
  is the page's.
- **A tag's CSS is established once per process**: whichever render reaches it first sets it. That is
  what stops a per-class sheet being emitted once per instance; the consequence is that CSS varying
  per request is dropped. A sheet a component adopts on the document itself warns when its text varies
  (`ssr-styles-vary`), once, naming the component; styles given through `@verajs/styles` are per class, on
  the client and the server alike, so the first CSS a class hoists is the one kept and a later one is
  dropped without a warning. Put what varies in custom properties (see the `@verajs/styles` README).

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
- **A process that has loaded `@verajs/ssr` is a server.** Wiring vera's renderer there —
  `wire([renderer])` or `wire([renderer({ shadow: 'open' })])` in app code the server and the browser
  share — declines its render insert (the server renders with its own) and keeps only the shadow default,
  so one shared wire call gives both sides the same default root; development says so once per process.
  Import `@verajs/ssr` before that wire call. Code that needs the client renderer in the same process (a
  test that server-renders and then hydrates) installs a client DOM and calls `renderInto` directly —
  `wire([renderer])` there registers no client render insert — or renders the server half in a separate
  process. The client renderer cannot draw into this DOM itself: it holds strings, not a tree. A renderer that is not vera's would displace the server's and is refused at render time; guard
  its wiring (`if (!isServer())`, `isServer` from `@verajs/core`).

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
  excludes ones read from layout (`input.width`), clamped (`meter.value`) or answering the document's URL when
  absent (`form.action`). A URL property reads back resolved against the document's URL, as a browser's does:
  `a.href = '/x'` reads `http://localhost/x`, or the same path on the `location` the render was given, while the
  markup keeps `/x`. `value`, `checked` and `selected` are mirrored to the markup deliberately: a browser keeps them
  off it, but on a server the markup is the whole output.
- **Events are real and propagate** — capture, target and bubble phases, `once`, `handleEvent`
  objects, `stopPropagation`, `stopImmediatePropagation`, `composedPath()`, a `dispatchEvent` return
  reflecting `preventDefault`, and a shadow boundary crossed only by a `composed` event. The walk is
  over the node tree, so an event does not continue into `document` or `window`.
- **Where the platform throws, this throws** — an attribute or tag name that cannot be written
  (`createElement('1a')` included: a name whose first character is not an ASCII letter follows the
  engines' rule), `attachShadow` on an element that cannot host a root (`<a>`, `<input>`, SVG) or a
  second time, a second `attachInternals`, an invalid custom-element name, a `dataset` key that no
  attribute spells (`dataset['a-b'] = 1`), a prefixed `setAttributeNS` name its namespace does not
  allow, a document inserted as a child, a child appended to text or a comment, a `createElement`,
  `createTextNode` or `createComment` with no argument, and every Node-typed argument that is not a
  node (`appendChild({})`, `removeChild(null)`, `contains({})`), with the platform's error name. `new HTMLElement()`, `new Node()` and `new X()` for a class never defined are
  an `Illegal constructor`, as they are in a browser. Lenience on a server does not make anything work;
  it moves the failure to the client and strips the context.
- **The Node interfaces are the platform's.** A text node is a `Node`, a `CharacterData` and a `Text`;
  `Node`'s constants are on every node; `append({})` inserts the text `[object Object]`, as the
  `(Node or DOMString)` union converts; and `String(node)` names its interface (`[object Text]`) — for
  text, comments, fragments and shadow roots. An element's name depends on its tag and is not yet
  answered (`[object Node]` here, `[object HTMLDivElement]` in a browser).
- **A selector this DOM cannot answer honestly throws** a `SyntaxError` `DOMException`, as a
  browser does for one it cannot read, rather than answering `null`. It matches type,
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
- **`localStorage`, `sessionStorage`, `indexedDB` and `caches` are deliberately absent** from this DOM.
  They are one browser's state; a server that invented an empty one would render a logged-out shell the
  client immediately replaces, with nothing failing anywhere. **But the runtime can bring its own:**
  components run against the process's globals, and Node 26 gives every process a working
  `sessionStorage`, shared by every request (`--localstorage-file` adds a `localStorage`). So
  `typeof localStorage === 'undefined'` is not a server test; guard per-user state with `isServer`
  from `@verajs/core` (`if (!isServer()) …`). A process with storage is told so once, in every build
  (`ssr-process-storage`).

**Where it deliberately differs:**

- **Markup is parsed as `innerHTML` parses it in a browser**: a `<template shadowrootmode>` in markup a component assigns
  stays a `<template>` whose `content` holds the root's markup, and the host gets no `shadowRoot` from it.
  `setHTMLUnsafe` and `Document.parseHTMLUnsafe`, which would attach one, are absent: `renderToString` decides where a
  declarative shadow root is written.
- **A collection is a plain array**, not a live `NodeList` — `childNodes`, `children`,
  `querySelectorAll`, the `getElementsBy*` family. There is nothing to be live over in a single pass;
  `item()` and `namedItem()` are provided anyway.
- **A constructed sheet holds its CSS as text**, so `cssRules` is empty and `deleteRule` refuses
  rather than pretends. `checkVisibility()` is always `false` and layout reads as zero, as for a
  detached element in a browser. A `style` value is kept as written (`url("data:…")` keeps its quotes).
- `insertAdjacentHTML` with `beforebegin` or `afterend` on an element with no parent (a component's own root)
  raises `NoModificationAllowedError`, as a browser does; on any element inside one it places the markup beside it.
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
  outside `<svg>`, `<math>`, `<noscript>` and `<select>` (the select parser before customizable select, which jsdom
  and older browsers run, reads a `<style>` there as markup; current engines read raw text), inside their HTML
  integration points (`<svg><foreignObject>`,
  `<math><mi>`…), after a breakout tag (`<svg><p>`, and `<font>` with a static `color`, `face` or `size`), and in a
  template rendered INTO a foreign position by its parent, which starts where its hole is
  (`html`<svg>${svg`<foreignObject><style>…`}</svg>`` is raw text). The scanner does not track the remaining ways a
  browser re-enters HTML: a `<font>` whose `color`, `face` or `size` is bound (a nullish value would remove it, so it is
  read as not breaking out), an end tag the parser ignores, and an `svg` or `mathml` template rendered on its own,
  outside any `<svg>` or `<math>`. There the browser reads HTML raw text, so a `>` in the stylesheet arrives as `&#62;`
  until hydration replaces it. That is the safe direction of a misreading on purpose: the other one writes a value's
  markup into the page. Put the stylesheet in the template that opens the foreign element, or outside it. A
  `<script>` in such a template, or inside `<noscript>`, takes no value at all (`ssr-script-hole`), JSON or not: where
  the server cannot tell an HTML or SVG script, both of which run, from one that does not, a value there is code. A
  `<script>` or `<textarea>` straight inside a `<select>` is read as anywhere in HTML: both parsers read its content
  as text.
- **`.innerHTML` markup is parsed in place on the server and as a fragment on the client.** The client parses
  the value with the element as its context; the served page is parsed with every real ancestor around it, so a
  few shapes nest differently on first paint — a `<p>` inside a `<p .innerHTML>` (the page closes the outer one),
  an `<a>` inside an `<a>`, table parts outside a table. Hydration re-assigns the value, so the client's DOM is
  right once the script runs; an inline handler in the markup (`onload`, `onerror`) therefore fires twice on an SSR
  page, once from the served HTML and once from the assignment. Inside `<svg>`/`<math>`, and on or inside a
  `<select>`, the server writes the value as escaped text, the safe side of the same misreading, until hydration
  assigns it: a `<select .innerHTML=${options}>` shows no options until then, so render them as children
  (`<select>${options}</select>`), which the server serves as options.
- **An ordinary element a template leaves open nests differently.** The client parses each template on its own
  and closes what it left open at its end; the server concatenates. Whatever changes how the rest of the page
  PARSES is closed at the template's end on the server too — a comment, `<style>`/`<script>`, `<textarea>` and the
  other text-only elements, `<svg>`, `<math>`, `<noscript>`, `<template>` — so a child can never reach its
  parent's markup. A plain `<b>` or `<div>` left open is not closed, so the parent's next markup nests inside it
  on the server and beside it on the client. Close every element inside the template that opens it.
- **A value inside a comment keeps the server's spacing.** Neither side writes a value into a comment, but where a
  binding is dropped the server leaves one space, so the statics on either side cannot join into another token:
  `<!--a${x}b-->` is served as `<!--a b-->` where the client writes `<!--ab-->`. Hydration keeps a comment's text,
  so the adopted page holds the server's; a comment is never shown. Asserted, with the server's real markup, in
  `tests/hydrate-roundtrip.test.mjs`.
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
- **A shadow root is served with the options it was opened with**: `mode`, `delegatesFocus`, `clonable`,
  `serializable` and `slotAssignment: 'manual'` (as `shadowrootslotassignment="manual"`). They have to be:
  `attachShadow` reuses a declarative root and ignores the options it is handed, so the client cannot repair one
  served without them.
- A function interpolated at a text position renders as nothing here and as its source on the
  client — put functions in `@event` bindings, where both sides drop them.
- **A hole right after a raw-text element's whole end-tag name (`<style>a</style${x}`) is refused here** as a
  tag-name hole (as core's renderer refuses it in development), while `@verajs/lite`, `@verajs/static` and core in
  production render it (the closer the value completes cannot end the element). Every shorter split (`</sty${x}`)
  renders everywhere. Safe both ways; such CSS is rare.
- **A template in an HTML `<title>` or `<textarea>` is refused here** (`ssr-template-in-text`), while core's renderer
  places it and warns in development that it is never shown there. Such a template is a mistake either way, and this
  server cannot write elements a browser would keep there: it reads that content back as text. Render a string.
- **A value inside `<iframe>`, `<noscript>` or an obsolete raw-text element is served escaped as text**, while core's
  renderer writes it fully encoded (every ASCII non-word character as a character reference), so the bytes differ and
  hydration rewrites that text. Both are inert after a save and reload; a template inside a `<noscript>` is refused
  here as one inside a text-only element is.
- **What a render creates leaves every store when its render ends.** Its components are reactive DURING the render
  (a write in a setup or a router's first navigation re-renders before the markup is written), and nothing they read
  keeps them alive afterwards. Module-scope state — a store, a `computed` — belongs to the process and stays live; a
  `computed` made inside a render and kept beyond it (stored on a module) stops updating when that render ends. Client
  code in the same process created while an async render is awaiting is treated as part of that render.
- **No streaming.** `renderToString` returns a string where `@lit-labs/ssr` yields a stream. That buys
  time-to-first-byte in proportion to how long a render takes, and a 100-row table here is about 45 µs
  — the response is built before a stream would flush its first chunk. Worth revisiting for a page big
  enough that it stops being true.

## Performance

`node bench/ssr.mjs` (fastest of 7 rotated rounds; run `cd bench && npm install` first), µs per render
— a small component, and a 100-row table (Node 24.18, Apple M1, 2026-11-21):

| | small | table |
| --- | --- | --- |
| **template serialization** — `serializeTemplate` vs `@lit-labs/ssr` | **0.3** | **31.7** |
| | lit 2.5 | lit 318.4 |
| **whole component** — `renderToString` vs a real `LitElement` | **2.4** | **45.2** |
| | lit 5.6 | lit 418.7 |

Vue's compiled SSR is 7.9 / 68.7 µs and React 6.2 / 458.0 µs, neither of which renders a component.
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
