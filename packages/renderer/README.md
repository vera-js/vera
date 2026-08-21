# @verajs/renderer

A keyed, template-identity renderer (~3.6 KB gzip): tagged templates, `.prop`/`?bool`/`@event`
and React-style `onClick` bindings, element refs, `keyed()` lists, `hold()` DOM preservation.
`@verajs/renderer/hydrate` is a drop-in superset whose first render ADOPTS server-rendered DOM —
markerless hydration (no framework comments in server HTML). SSR apps import from `/hydrate`;
everyone else pays zero hydration bytes.

Wire once: `setRenderer(render)` from `@verajs/core`.
