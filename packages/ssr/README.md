# @verajs/ssr

Vera-native server-side rendering. Node-only, plain ESM, **zero dependencies** — no wcc, no lit,
no acorn, no parse5.

    import { renderToString } from '@verajs/ssr';        // ('/vera' also works)
    const { html, styles } = await renderToString(new URL('./components/app.js', import.meta.url));

- Node resolves the component's module graph natively (the `.ts`-via-`.js` convention included);
  execution registers classes through `customElements.define` — no AST walking.
- Templates flatten through a sigil-aware serializer with per-template-identity plan caching:
  `?bool` resolved by truthiness, `.value`/`.checked`/`.selected` mirrored to attributes,
  `@event`/`&ref` stripped without residue, every interpolated value escaped at the boundary.
- Output is declarative shadow DOM with **zero framework comments**; light-DOM `@scope` styles are
  returned separately for the page shell.
- Client-side, `@verajs/renderer/hydrate` adopts the server DOM markerlessly (swap one import).
- Measured (`node bench/ssr.mjs`, fastest of 7 rounds), **100-row table**: serializer ~46 µs,
  full component pipeline ~64 µs — the serializer ahead of Vue's compiled SSR (~62 µs) and the
  full pipeline within a few percent of it, against ~315 µs for lit and ~459 µs for React.
- **On a single small component lit is faster** — ~2.5 µs against ~8 µs for the full pipeline.
  The per-component cost here is instantiation and `connectedCallback`, which a list amortises
  and a one-element page does not. Both cases are in the benchmark; run it rather than taking
  either number on trust.

`examples/ssr-node/server-native.mjs` is a complete server on bare `node:http`.

Import `@verajs/ssr` before anything that imports `@verajs/core` — it installs the server
environment first.

**The entry component is found by matching the module's exports against the registry**, so export
the class (`export default class …`) or pass `{ tag }`. It used to guess by diffing the registry
around the import, which two concurrent renders could not share: both saw both modules' new
registrations, and a request could be answered with another component's markup.

`renderToString` executes the module you name. **The URL is yours to bound** — the same care
`import()` always needs. A server that maps a request path to a component file must confirm the
resolved path stays inside its components directory before calling, exactly as `@verajs/autoloader`
does for the URLs it derives.

Known limits: effects run server-side and after the markup is built, so guard browser-only work;
`keyed`/`hold` are client constructs (use plain `.map` in SSR templates); a function interpolated at
a text position renders as nothing here and as its source on the client — put functions in `@event`
bindings, where both sides drop them.

The pre-native strategies (wcc fork, lit-labs renderer, Astro sketch, Reef-era diff renderer)
are retired; strategy 4 is the only one shipped.
