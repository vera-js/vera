---
'@verajs/ssr': patch
---

The object form of `renderToString`'s `attributes` option refuses an `on…` name (`onclick`, `onClick`, `ONLOAD`)
with `ssr-attribute-handler`, in every build. Its value was served as a live inline handler, while a value bound
into an `on…` attribute in a template is dropped: one rule now decides both. Write the handler in the component — a
static attribute in its template, or an `@event` binding. The string form of `attributes` is raw markup, as before.
