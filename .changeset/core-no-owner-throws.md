---
'@verajs/core': minor
---

A hook, `render()` or `mount()` with no component being set up now throws (`no-owner`, in every build)

**Breaks:** `async connectedCallback() { init(this); await load(); useEffect(…); render(…) }` — an `await` BETWEEN
`init()` and a hook or `render()`. It worked for a component alone and now throws, in the browser and on the server
(`renderToStringAsync`) alike. Three fixes, in the order the message gives them:

1. Await **before** `init(this)`: `const data = await load(); init(this); …`
2. Or set up first and write what arrives into state: `init(this); const state = createStore({ data: null });
   render(…); state.data = await load();`
3. Or pass the element to a hook created later: `useEffect(fn, this)`.

**Fixes:** setup used to stay open until a `render()`/`mount()` or the next component's `init()`, so the same code
behaved three ways: alone it worked; overtaken by a component that had finished setup, its hooks were dropped
silently; overtaken by one still mid-setup (another async component, initialized later), its hooks — and its render —
attached to THAT component and ran against the wrong element, with no error. Setup now ends at the end of `init()`'s
microtask turn, so a hook after an `await` fails the same way every time, naming the fixes. A hook or `render()` from
a handler after setup, and a second `render()`, fail the same way (they did nothing before).
