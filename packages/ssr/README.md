# @verajs/ssr

Vera-native server-side rendering. Node-only, plain ESM, **zero dependencies** — no wcc, no lit,
no acorn, no parse5.

Nested components are found by walking the emitted markup for tags the registry knows. The walk is
state-aware, not a regex: it respects quoted attribute values (a `>` is legal inside one), and it
leaves the contents of comments, `<script>`, `<style>`, `<textarea>` and `<title>` alone, because
those are text and a scan for elements has no business reading them.

    import { renderToString } from '@verajs/ssr';        // ('/vera' also works)
    const { html, styles, title } = await renderToString(new URL('./components/app.js', import.meta.url), {
      attributes: { 'user-id': id },   // an object — values are escaped
      props: { rows },                 // structured data; an attribute can only carry a string
      children: '<p>slotted</p>',      // what a <slot> in the component renders
      location: request.url,           // this request's URL — see below
      seen,                            // a Set carried across renders — see below
    });

`title` is `document.title` as that render left it — a component setting it is how a shell names its
page — and it is **returned rather than left on the global**, for the same reason `location` is
passed rather than assigned: a process global cannot belong to one request. The document's own title
is restored afterwards, so a concurrent render never sees it.

For a shell assembled from several islands, carry one `Set` through every call. Each render returns
the styles of what *it* rendered, so two islands sharing a component would otherwise each carry that
component's CSS and the page would ship it twice.

**Pass `location` rather than assigning to `globalThis.location`.** A component that reads the URL —
any routed shell does — needs the request's, and `globalThis.location` is process-global while a
request is not. Assigning to it and then calling `renderToString` is safe only until two requests
overlap: the call awaits `import()`, and on a module's first import that await yields, so whichever
request assigned last wins for every render after it. Measured with three concurrent first-time
imports, **two of three rendered another request's path**. The option applies the URL after every
await and restores it afterwards, in a stretch that is synchronous end to end and therefore cannot
interleave. A path or a full URL both work.

**`children`, and the string form of `attributes`, are raw markup.** Both are written through
untouched — that is what they are for — so neither may carry anything from a request without being
sanitized first. Everything else is checked at the render boundary: the object form of
`attributes` cannot escape the tag it describes **and cannot add a second attribute inside it** — a
name carrying a space, a quote, `/`, `=` or `>` is refused, which is the same set `setAttribute`
refuses in the browser — and every interpolated value in a template is escaped as it is written. A
`__proto__` key in `props` is skipped rather than assigned, so handing the option a parsed request
body cannot replace the component's prototype. Reach for the string form of `attributes` only when you must produce markup an object cannot
describe.

- Node resolves the component's module graph natively (the `.ts`-via-`.js` convention included);
  execution registers classes through `customElements.define` — no AST walking.
- **The lifecycle runs the way it does in a browser.** `attributeChangedCallback` fires on upgrade
  for every present observed attribute and again on every later change; there is no animation frame
  to wait for — frames are queued and drained once `connectedCallback` returns, and again for
  whatever those schedule, so a re-render and every `useEffect` land before the markup is
  serialized, coalesced exactly as a browser coalesces them. An endless animation loop is bounded
  rather than run forever. `tests/lifecycle-parity.test.mjs` renders each case on both sides and
  compares the DOM.
- **A failure during a render rejects — it is never markup.** Core isolates a hook error so one bad
  effect cannot take out the hooks beside it, which is right in a browser because the next render
  can recover. There is no next render here, so `renderToString` collects those failures and throws,
  naming the component. Catch it to fall back to a client-rendered shell, as you would with React or
  Vue.
- **Events are real** — `EventTarget` semantics on elements, shadow roots, `document` and `window`,
  including `once`, `handleEvent` objects, `event.target` and a `dispatchEvent` return value that
  reflects `preventDefault`. What is absent is **bubbling**: this DOM holds children as a string, so
  there is no ancestor chain to walk and an event reaches its own target's listeners and stops.
- **The server DOM is complete, and checked twice.** Every member a real element, shadow root,
  document, `CSSStyleSheet`, `DOMTokenList` **or window** exposes in Chromium, Firefox and WebKit is
  either implemented or listed as out of scope with a reason — and every member that *is* implemented
  is then compared against a real DOM, member by member, so one that exists and answers differently
  fails too. That second check is the one that earns its keep: enumerating presence found a single
  gap, while comparing behaviour found `tabIndex` defaulting to 0, `draggable` defaulting to true,
  `role` answering `''` where the platform answers `null`, `textContent = null` writing the word
  "null", and a closed shadow root handed straight back. **That comparison checks a member's *shape*
  — the type it answers with — not its answer to every input**, so it is a net rather than a proof:
  an empty array and a full one look the same to it. Three separate classes of defect were found by
  going around it deliberately — passing values nobody would pass (a symbol, where the platform
  throws), checking the members jsdom does not implement at all (which it must skip), and asking
  whether a member that answers *emptily* should have answered at all. The window's ~700 interface constructors are
  covered by a rule rather than a list: every interface this DOM implements is exposed, so
  `instanceof` answers for anything it hands you — the list is checked in (`tests/dom-surface.mjs`, no dependency involved) and
  both halves are enforced, so a gap fails a test instead of a render. That includes the sixty reflected
  properties (`id`, `className`, `hidden`, `tabIndex`, `role`, the whole `aria*` family), which are
  views of an attribute and therefore reach the markup, and `attachInternals()`, so a
  form-associated custom element runs, and the objects those members hand back — `classList`,
  `style`, `dataset` — are held to the same list rather than assumed complete once the property
  exists. `attachShadow({ mode: 'closed' })` behaves as it does in a browser: `element.shadowRoot`
  is `null`, and the root is serialized anyway, because declarative shadow DOM expresses `closed`
  and the client re-creates it just as hidden. **Where the platform throws, this throws** — an
  attribute or tag name that cannot be written, a second `attachShadow` or `attachInternals`, an
  invalid custom-element name, `appendChild` of a non-node. A server that is lenient about an error
  does not make anything work; it moves the failure to the client and strips the context. The
  exceptions are deliberate: **a selector this DOM cannot answer honestly throws** rather than
  answering `null` — it matches on structure and attributes, and a pseudo-class needs user state,
  layout or a document that a server does not have, so `:hover` raises instead of quietly reporting
  no match;
  **`checkVisibility()` is always `false`**, since nothing here is laid out and a
  server cannot know what CSS will do, a constructed sheet holds its CSS as **text** rather
  than a parsed rule list — so `cssRules` is empty whatever the sheet contains, which is all the
  markup needs and is why `deleteRule` says so rather than pretending, and `insertAdjacentHTML` with `beforebegin` or
  `afterend` raises a message explaining that a server-rendered component has no parent, which is
  more use than the platform's bare `SyntaxError`. A `style` value is stored as it was
  written rather than re-serialized, so `url("data:…")` keeps its quotes where a browser's CSS
  serializer drops them — equivalent CSS, and a semicolon inside a value does not split the
  declaration, which is what matters for an inline `data:` URI. Queries answer emptily and layout reads as zero because that
  is what a detached element answers in a browser too. **Names fold the way the platform folds
  them**: an HTML element lower-cases its tag and its attribute names, so `setAttribute('Data-Flag', …)`
  and `getAttribute('data-flag')` are one attribute and an `attributes` entry spelled `User-ID`
  still matches an `observedAttributes` entry spelled `user-id`; an element created through
  `createElementNS` outside the HTML namespace keeps its case, so an SVG `viewBox` survives.
- **A component can build another component.** `document.createElement('my-comp')` constructs the
  registered class, so its field initialisers have run and `instanceof` answers, and appending it
  renders **that instance** — everything the parent assigned to it, `kid.rows = data` included,
  survives. The nested-component scan used to re-create the child from its markup, where an
  attribute is the only thing that can carry a value.
- **`render()` owns its own range and nothing else**, exactly as it does in a browser. Content
  already in the container stays before the rendered range, a node the component appends to its own
  root stays after it, and both survive every re-render — so a component that mixes `render()` with
  its own `appendChild` produces the same DOM on both sides. It also means `children` reach a
  light-DOM component and are still there after it renders.
- **A `<select>`'s value is served as `<option selected>`.** And a value matching no option cannot be served —
  see the exception below, which has no fix. A `<select>` has no `value` content attribute — assigning the property *selects an
  option* — so the only thing markup can say is which option is chosen, and that is what the
  serializer writes (React's server renderer does the same; `@lit-labs/ssr` drops the binding and
  serves a control showing its first option). Matching follows the platform: the `value` attribute
  verbatim if an option has one, otherwise the option's text **stripped and collapsed**, first match
  wins, and a `selected` the author wrote is cleared because a property assignment overrides markup.
  All of it is asserted against Chromium, Firefox and WebKit in
  `tests/browser/select-value.test.js`.

  The exception is real and has no fix. When the value matches **no** option the client leaves
  `selectedIndex` at `-1` with nothing showing, and a parsed `<select>` whose options carry no
  `selected` takes its **first** — there is no markup for "none of them", and inserting a hidden
  placeholder would change the control the author wrote.

- **Component nesting is capped at 256 levels, and the client has no such cap.** A component that
  renders itself recurses without bound, which on a server is a hung request rather than a hung tab,
  so `renderToString` refuses past 256 and says so. This is a real divergence, and 256 is chosen to
  sit *below where the client breaks*: the client managed about 340 levels before `RangeError`
  (reported through the `'error'` insert), so the server still fails first and fails with a sentence.
  That ~340 is engine-dependent, which is why the server does not wait for it.
- **A carriage return survives, as `&#13;` — everywhere except `<style>` and `<script>`.** The HTML
  input-stream preprocessor collapses CR and CRLF to a single LF *before* tokenization, so a raw
  `\r` written into markup does not come back — the server would render `a\r\nb` and the client read
  `a\nb`, which is a silent hydration mismatch on every render of a `<textarea>` value, a CSV cell, or
  any string from a Windows-authored source. Character references are resolved *after* preprocessing,
  so the escaped form does survive; verified identical in Chromium, Firefox and WebKit.

  **RAWTEXT is the exception, and it is not fixable.** A browser does not decode a character
  reference inside `<style>` or `<script>` — that is what makes them RAWTEXT — so `&#13;` there is
  the literal six characters, while the preprocessor still collapses the raw CR. There is no spelling
  of a carriage return that survives in those two elements. `<title>` and `<textarea>` are RCDATA,
  which *does* decode references, which is why they round-trip correctly. All three behaviours are
  asserted against Chromium, Firefox and WebKit in `tests/browser/rawtext-carriage-return.test.js`.

  In practice this reaches an interpolated stylesheet or inline script whose source has Windows line
  endings — a repository checked out with `core.autocrlf=true` puts CRLF inside every template
  literal, `css` blocks included. CR and LF are interchangeable whitespace to both CSS and
  JavaScript, so nothing renders wrongly; the two sides simply hold different strings.
- **Three things cannot survive a server round trip, and are the only three.** Two are characters and
  one is a character in a position — see the carriage return above, which round-trips everywhere
  except inside `<style>` and `<script>`.
  - **NUL** (`\u0000`) is dropped in text, rewritten to U+FFFD in an attribute **and inside
    RAWTEXT**, and `&#0;` is a parse error that also yields U+FFFD. No spelling round-trips, so it is left alone rather than
    silently turned into U+FFFD — that would make the markup lie about what the component rendered
    without making the two sides agree.
  - **A lone surrogate** (`\uD800` with no pair) is not encodable in UTF-8, so the *transport*
    replaces it with U+FFFD — a real HTTP response does exactly what `Buffer.toString('utf8')` does.
    Nothing server-side can prevent that.

  Both are covered by `tests/ssr-text-boundary.test.mjs`, alongside astral pairs, combining marks,
  bidi controls, noncharacters and 20 other cases that *do* round-trip exactly.
- **What a component does to itself in `connectedCallback` reaches the markup** — a `setAttribute`,
  an `aria-*`, a class, a reflected property.
- **`<style>` and `<script>` content is written raw**, and their own end tags are neutralised
  (`<\/style`, `<\/script` — valid CSS and JavaScript, invisible to the tokenizer). A browser does
  not decode a character reference inside either, so escaping there protects nothing and corrupts
  the content: an interpolated `.a > .b` used to serve `.a &#62; .b`, a selector matching nothing,
  while the client rendered it correctly. `<title>` and `<textarea>` are RCDATA rather than RAWTEXT
  — references *are* decoded there — so those keep ordinary escaping, which is also what the client
  produces for them.
- Templates flatten through a sigil-aware serializer with per-template-identity plan caching:
  `?bool` resolved by truthiness, `.value`/`.checked`/`.selected` mirrored to attributes,
  `@event`/`&ref` stripped without residue, every interpolated value escaped at the boundary.
- Output is declarative shadow DOM with **zero framework comments**; light-DOM `@scope` styles are
  returned separately for the page shell.
- Client-side, `@verajs/renderer/hydrate` adopts the server DOM markerlessly (swap one import).
- Measured (`node bench/ssr.mjs`, fastest of 7 rounds), against lit on both comparisons it
  supports — µs per render, small component / 100-row table:

  | | small | table |
  | --- | --- | --- |
  | **template serialization** — `serializeTemplate` vs `@lit-labs/ssr` on a template | **0.3** | **35** |
  | | lit 2.4 | lit 312 |
  | **whole component** — `renderToString` vs a real `LitElement` | **4.3** | **49** |
  | | lit 5.7 | lit 414 |

  Vue's compiled SSR is 7.9 / 61 µs and React 6.2 / 453 µs, neither of which renders a
  component. The `lit element` row runs in a separate process because `@lit-labs/ssr` and this
  package both install DOM globals and cannot share one.
- **Most of a component render is core's lifecycle, not this package.** Rendering the same component
  with its `connectedCallback` emptied — which removes core's `init`, store, hooks and re-render and
  leaves the shim, the serializer and the nested scan — costs **1.0 µs of a 6.4 µs render**, so
  everything this package does is about a sixth of it and the component's own lifecycle is the rest.
  (Those two figures come from a plain `await` loop rather than `bench/ssr.mjs`'s batched rounds, so
  they are higher than the table above and only their *ratio* is comparable.)

`examples/ssr-node/server-native.mjs` is a complete server on bare `node:http`, serving the whole
round trip — the page it returns ships a client module that imports `@verajs/renderer/hydrate` and
adopts the markup in place.

**No streaming.** `renderToString` returns a string, where `@lit-labs/ssr` yields a stream. That
buys time-to-first-byte in proportion to how long a render takes, and a 100-row table here is 47 µs
— the response is built before a streaming implementation would have flushed its first chunk. It is
a real difference in shape, and worth revisiting for a page big enough that it stops being one.

**Importing `@verajs/ssr` installs a DOM on `globalThis`.** That is what it is for, and it means the
import is not passive: `document`, `customElements`, `HTMLElement` and the rest are *replaced*, so a
process that already has a DOM — jsdom in a test, say — loses it the moment this module is loaded,
however late. A component defined afterwards is never upgraded and nothing says why. **Exercise both
sides in separate processes**, which is what this repo's own tests do; `tests/lifecycle-parity.test.mjs`
renders the server half in a subprocess for exactly this reason.

**And import it first**, before anything that imports `@verajs/renderer`.

The module that actually needs the shims is the renderer, not core: it builds two shared
`TreeWalker`s at import time, so importing it against a bare Node global object throws before your
component ever runs. A component reaches it through `keyed` or `hold`, which is why the rule reads
as "import this first" — measured, core, `@verajs/styles` and `@verajs/router` are all order-
independent, and only `@verajs/renderer` is not.

**The entry component is found by matching the module's exports against the registry**, so export
the class (`export default class …`) or pass `{ tag }`. It used to guess by diffing the registry
around the import, which two concurrent renders could not share: both saw both modules' new
registrations, and a request could be answered with another component's markup.

`renderToString` executes the module you name, so **pass `base` whenever any part of the URL came
from a request**:

    renderToString(new URL(`${page}.js`, components), { base: components });

Anything resolving outside it is refused. `new URL` applies `../` before `renderToString` sees the
string, so without this the traversal has already happened by the time the call is made — and
mapping a route to a component file is the obvious way to use a server renderer. Same containment,
and the same wording, as `@verajs/autoloader` uses for the URLs it derives.

It is opt-in because most calls name a constant, and a check that is always trivially satisfied
stops being read.

The globals a component reaches for are here too — `matchMedia` (matching nothing, as every server
renderer answers), `getComputedStyle` (empty, as a detached element gives in a browser),
`IntersectionObserver`/`ResizeObserver`/`MutationObserver`/`PerformanceObserver` (inert, because
they observe things a server does not have, but constructing one must not throw), `requestIdleCallback`
(which joins the frame queue), and the DOM interfaces themselves so `instanceof Node` answers rather
than throwing.

**`localStorage`, `sessionStorage`, `indexedDB` and `caches` are deliberately absent.** They are one
browser's state, and a server that invented an empty one would render a logged-out shell that the
client immediately replaces, with nothing failing anywhere. `typeof localStorage === 'undefined'` is
the guard the ecosystem already writes, and it only works if this does not lie. The same list is
enforced in `tests/ssr-dom-surface.test.mjs`, in both directions.

Known limits:

- **`connectedCallback` must be synchronous.** Rendering recurses inside `String.replace`, which
  cannot await, so an `async connectedCallback` is refused with an error rather than rendered empty.
  Load data before `renderToString` and pass it in as attributes.
- **`useLayoutEffect` runs, but too late to reach the template it sits beside.** It is coalesced on
  a microtask, and `renderToString` is asynchronous, so it *does* execute — a `setAttribute` or an
  API call inside one happens on the server, which is worth knowing before you put one there. What
  it cannot do is change what the template already rendered: state settled in a layout effect is not
  in the markup. Settle it before `render()`, or use `useEffect`, whose frame is drained repeatedly
  and does reach the markup. `tests/lifecycle-parity.test.mjs` pins both halves of that.
- `keyed`/`hold` are client constructs; use plain `.map` in SSR templates.
- **A routed component renders its shell, not its route.** `initRouter` works server-side — the
  shim provides enough `window` for it — so the nav and the `[view]` outlet reach the markup and the
  client fills the outlet on hydration. The route's own content does not, because the server holds
  markup as a string rather than a tree and the router finds its outlet by query. Render the route
  yourself and pass it as `children` if it has to be in the first response.
- **A dynamic attribute *name* is refused.** `<b ${name}="x">` is malformed on both sides: the
  client hands the template to the platform's parser and a marker is not a name, and this serializer
  used to emit `<b="x">`, which is not an attribute either. Rather than write markup no browser would
  produce, it throws and names the alternative — `@verajs/renderer/spread`, which exists for names
  that are not known until runtime and which this serializer understands.
- **`slotAssignment` cannot be server-rendered.** Declarative shadow DOM can express `mode`,
  `delegatesFocus`, `clonable` and `serializable` — all of which are serialized — but has no form
  for manual slot assignment, and `attachShadow` **ignores the options it is handed** when it reuses
  a declarative root, so the client cannot repair what the markup left out.
- A function interpolated at a text position renders as nothing here and as its source on the
  client — put functions in `@event` bindings, where both sides drop them.

The pre-native strategies (wcc fork, lit-labs renderer, Astro sketch, Reef-era diff renderer)
are retired; strategy 4 is the only one shipped.
