---
'@verajs/ssr': patch
---

A page component whose constructor throws now rejects the render naming its tag (`ssr-render-threw`), with the
thrown error as the cause, as a nested component's constructor and every component's callbacks already did; it
rejected with the bare error.
