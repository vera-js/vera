---
'@verajs/router': patch
---

`navigate({ name })` with an unknown name now returns `false` instead of `true`. The empty path an
unknown name resolves to used to meet the same-path early return and report a successful
navigation — to exactly the code the docs tell you to write (`await navigate()` and handle the
failure). The page never moves either way; the promise now says so.
