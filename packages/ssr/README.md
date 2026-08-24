# @verajs/ssr

Vera-native server-side rendering. Node-only, plain ESM, **zero dependencies** — no wcc, no lit,
no acorn, no parse5.

Nested components are found by walking the emitted markup for tags the registry knows. The walk is
state-aware, not a regex: it respects quoted attribute values (a `>` is legal inside one), and it
leaves the contents of comments, `<script>`, `<style>`, `<textarea>` and `<title>` alone, because
those are text and a scan for elements has no business reading them.

    import { renderToString } from '@verajs/ssr';        // ('/vera' also works)
    const { html, styles } = await renderToString(new URL('./components/app.js', import.meta.url), {
      attributes: { 'user-id': id },   // an object — values are escaped
      props: { rows },                 // structured data; an attribute can only carry a string
      children: '<p>slotted</p>',      // what a <slot> in the component renders
      location: request.url,           // this request's URL — see below
      seen,                            // a Set carried across renders — see below
    });

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
sanitized first. Everything else is escaped at the render boundary: the object form of `attributes`
cannot escape the tag it describes, and every interpolated value in a template is escaped as it is
written. Reach for the string form of `attributes` only when you must produce markup an object cannot
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
- **The server DOM is complete.** Every member a real element, shadow root, document or
  `CSSStyleSheet` exposes in Chromium, Firefox and WebKit is either implemented or listed as out of
  scope with a reason — the list is checked in (`tests/dom-surface.mjs`, no dependency involved) and
  both halves are enforced, so a gap fails a test instead of a render. That includes the sixty reflected
  properties (`id`, `className`, `hidden`, `tabIndex`, `role`, the whole `aria*` family), which are
  views of an attribute and therefore reach the markup, and `attachInternals()`, so a
  form-associated custom element runs. Queries answer emptily and layout reads as zero because that
  is what a detached element answers in a browser too.
- **A component can build another component.** `document.createElement('my-comp')` constructs the
  registered class, so its field initialisers have run and `instanceof` answers, and appending it
  renders **that instance** — everything the parent assigned to it, `kid.rows = data` included,
  survives. The nested-component scan used to re-create the child from its markup, where an
  attribute is the only thing that can carry a value.
- **What a component does to itself in `connectedCallback` reaches the markup** — a `setAttribute`,
  an `aria-*`, a class, a reflected property.
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
  | | lit 2.4 | lit 308 |
  | **whole component** — `renderToString` vs a real `LitElement` | **3.5** | **49** |
  | | lit 5.6 | lit 409 |

  Vue's compiled SSR is 9.5 / 61 µs and React 6.2 / 450 µs, neither of which renders a
  component. The `lit element` row runs in a separate process because `@lit-labs/ssr` and this
  package both install DOM globals and cannot share one.
- 94% of the component pipeline is core's lifecycle rather than this package: instantiating the
  element and running `connectedCallback` measured 4.69 µs of a 4.99 µs render, with the
  nested-component scan at 0.06 µs.

`examples/ssr-node/server-native.mjs` is a complete server on bare `node:http`, serving the whole
round trip — the page it returns ships a client module that imports `@verajs/renderer/hydrate` and
adopts the markup in place.

**No streaming.** `renderToString` returns a string, where `@lit-labs/ssr` yields a stream. That
buys time-to-first-byte in proportion to how long a render takes, and a 100-row table here is 47 µs
— the response is built before a streaming implementation would have flushed its first chunk. It is
a real difference in shape, and worth revisiting for a page big enough that it stops being one.

**Import `@verajs/ssr` first**, before anything that imports `@verajs/renderer`.

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
- **`useLayoutEffect` does not run.** It is scheduled on a microtask and a server render is
  synchronous end to end, so there is no point between "the render finished" and "the markup was
  serialized" for one to run in. React's does not run during SSR either, for the same reason.
  Settle that state before `render()`, or use `useEffect`, which does run.
- `keyed`/`hold` are client constructs; use plain `.map` in SSR templates.
- **A routed component renders its shell, not its route.** `initRouter` works server-side — the
  shim provides enough `window` for it — so the nav and the `[view]` outlet reach the markup and the
  client fills the outlet on hydration. The route's own content does not, because the server holds
  markup as a string rather than a tree and the router finds its outlet by query. Render the route
  yourself and pass it as `children` if it has to be in the first response.
- **A dynamic attribute *name* is not supported** — `<b ${name}="x">` produces a working attribute
  here and malformed markup in the browser, because the client hands the template to the platform's
  parser and a marker is not a name. Use `@verajs/renderer/spread`, which exists for names that are
  not known until runtime and which this serializer understands.
- **`slotAssignment` cannot be server-rendered.** Declarative shadow DOM can express `mode`,
  `delegatesFocus`, `clonable` and `serializable` — all of which are serialized — but has no form
  for manual slot assignment, and `attachShadow` **ignores the options it is handed** when it reuses
  a declarative root, so the client cannot repair what the markup left out.
- A function interpolated at a text position renders as nothing here and as its source on the
  client — put functions in `@event` bindings, where both sides drop them.

The pre-native strategies (wcc fork, lit-labs renderer, Astro sketch, Reef-era diff renderer)
are retired; strategy 4 is the only one shipped.
