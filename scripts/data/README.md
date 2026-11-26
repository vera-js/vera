# Vendored data

- `whatwg-entities.json`: the HTML Standard's named character references, copied unchanged from
  <https://html.spec.whatwg.org/entities.json> on 2026-11-25. © WHATWG (Apple, Google, Mozilla, Microsoft), licensed
  under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). `scripts/gen-entities.mjs` pins its sha256 and
  writes `packages/ssr/src/vera/entities.ts` from it, so replacing the file means changing that pin in the same commit.
