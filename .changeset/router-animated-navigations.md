---
'@verajs/router': patch
---

`router({ animate: true })` — the connector is a dual now: wire it bare as before, or call it
with options first. With animate on, every navigation wraps its routed renders in the platform's
view transition (the landing render never animates; reduced motion and unsupporting engines
route instantly; a throwing guard still rejects `navigate()`). Routes gain `load`, the
chunk-warming half of a lazy route, resolved before the transition wraps so an import never
stalls a frozen page.
