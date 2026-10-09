---
'@verajs/core': patch
---

`useEffect(async () => …)` works: only a returned function is a cleanup

An async callback returns a promise, and core took it as the cleanup — calling it on the next run and on removal
printed `[vera] a hook threw:`. It now just runs (`useEffect`, `useLayoutEffect`, `useHook`), the type admits it, and
development names an async callback once: it cannot clean up, and what it awaits can arrive late — write a plain
effect that starts the work and returns a cleanup that cancels it.
