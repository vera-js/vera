# @verajs/renderer

A keyed, template-identity renderer (<!--size:renderer.gzip-->3.61 KB<!--/size:renderer.gzip--> gzip): tagged templates, `.prop`/`?bool`/`@event`
and React-style `onClick` bindings, element refs, `keyed()` lists, `hold()` DOM preservation.
`@verajs/renderer/hydrate` is a drop-in superset whose first render ADOPTS server-rendered DOM —
markerless hydration (no framework comments in server HTML). SSR apps import from `/hydrate`;
everyone else pays zero hydration bytes.

`@verajs/renderer/profiler` is a development-only entry that reports how many templates were
committed in place versus torn down and rebuilt, naming the template pairs that churn and where.
`showProfiler()` puts the same information in a live panel in the corner of the page. It costs
production nothing — the instrumentation is removed by the build, not merely unused.

Wire once: `setRenderer(render)` from `@verajs/core`.
