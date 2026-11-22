---
'@verajs/styles': patch
---

`:host(…)` in a light component's styles keeps its whole argument when it holds a nested call: `:host(:not(.a):hover)`
now becomes `:scope:not(.a):hover`. The rewrite stopped at the first `)`, which gave `:scope:not(.a:hover)`, a
different selector.
