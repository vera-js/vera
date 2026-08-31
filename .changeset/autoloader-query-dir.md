---
'@verajs/autoloader': patch
---

Refuse an `autoload-dir` containing `?` or `#` instead of quietly fetching the wrong module.

The default layout builds `${dir}/${tag}${extension}` as text, and URL syntax then reads the result
rather than the intent. Both characters end the path, so `autoload-dir="components?v=2"` — an
ordinary cache-buster, which is why this is a mistake someone makes rather than an attack — resolved
to `components?v=2/my-card.js`. The request went to `components` with the tag name inside the query
string, and the component file was never asked for. A fragment is worse: it never reaches the network,
so `components` is fetched outright. `autoload-dir="?"` resolved to the entry module itself, under a
URL distinct enough to evaluate the whole application a second time.

The containment check could not catch any of this, because every one of those URLs is genuinely
inside the entry's own directory — that is the only question containment asks.

`resolve` is unaffected: it replaces URL building entirely and is the supported way to add a query,
so `resolve: (tag, dir) => `${dir}/${tag}.js?v=2`` keeps working, and it still receives a `dir` with a
query rather than having it refused first.
