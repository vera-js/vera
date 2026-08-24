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
      seen,                            // a Set carried across renders — see below
    });

For a shell assembled from several islands, carry one `Set` through every call. Each render returns
the styles of what *it* rendered, so two islands sharing a component would otherwise each carry that
component's CSS and the page would ship it twice.

`attributes` also accepts a raw string, which is written through untouched — reach for it only when
you must produce markup an object cannot describe, and never with anything from a request.

- Node resolves the component's module graph natively (the `.ts`-via-`.js` convention included);
  execution registers classes through `customElements.define` — no AST walking.
- The server element is a detached, childless one: `dispatchEvent`, `classList`, `tagName`,
  `ownerDocument`, `closest`, `getRootNode`, `children` and the rest answer rather than throw, and
  **what a component does to itself in `connectedCallback` reaches the markup** — a `setAttribute`,
  an `aria-*`, a class. `querySelector` returns null and `children` is empty, because nothing has
  been parsed into it.
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
  | **template serialization** — `serializeTemplate` vs `@lit-labs/ssr` on a template | **0.3** | **40** |
  | | lit 2.5 | lit 309 |
  | **whole component** — `renderToString` vs a real `LitElement` | **3.2** | **53** |
  | | lit 5.7 | lit 410 |

  Vue's compiled SSR is 7.5 / 59 µs and React 6.4 / 452 µs, neither of which renders a
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

Import `@verajs/ssr` before anything that imports `@verajs/core` — it installs the server
environment first.

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

Known limits:

- **`connectedCallback` must be synchronous.** Rendering recurses inside `String.replace`, which
  cannot await, so an `async connectedCallback` is refused with an error rather than rendered empty.
  Load data before `renderToString` and pass it in as attributes.
- **Effects run, but their writes do not reach the markup.** `useEffect` fires during the render, so
  guard browser-only work — but a state change it makes schedules a re-render that happens after the
  string has been built, and the markup shows the value from before the effect.
- `keyed`/`hold` are client constructs; use plain `.map` in SSR templates.
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
