---
'@verajs/ssr': patch
'@verajs/core': patch
---

A server render's components are released when it ends

Each `renderToString` / `renderToStringAsync` is a turn: the hooks its tree created leave every store when it ends, so
a module-scope store read by server-rendered components no longer keeps every rendered component alive for the life of
the process, and a later write no longer re-runs renders that already served their request.
