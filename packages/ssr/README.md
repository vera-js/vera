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
- Measured (bench/ssr.mjs, fastest-of-7 rotated): serializer 73 µs / full component pipeline
  107 µs on a 100-row table — ahead of or within 9% of Vue's compiled SSR, 5x lit, 8x React.

`examples/ssr-node/server-native.mjs` is a complete server on bare `node:http`.

Import `@verajs/ssr` before anything that imports `@verajs/core` — it installs the server
environment first. Known limits: effects run server-side (guard browser-only work);
`keyed`/`hold` are client constructs (use plain `.map` in SSR templates).

The pre-native strategies (wcc fork, lit-labs renderer, Astro sketch, Reef-era diff renderer)
are retired; strategy 4 is the only one shipped.
