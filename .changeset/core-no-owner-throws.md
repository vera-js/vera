---
'@verajs/core': minor
---

A hook, `render()` or `mount()` with no component being set up now throws (`no-owner`, in every build)

Setup is one synchronous block: it starts at `init()` and ends at the end of that microtask turn. A hook, `render()` or
`mount()` after an `await` in setup — or later, from a handler — finds no component and throws, naming the fixes:
await before `init(this)`; or create hooks and render first and write what arrives into state; or pass the element
explicitly (`useEffect(fn, this)`). It used to be dropped silently, or attached to whichever component had connected
meanwhile, so one component alone worked and two on a page did not — the same code now fails the same way every time.
