---
'@verajs/core': minor
'@verajs/renderer': patch
---

`effect(fn, options)` is the one primitive for work that follows state; `portal(target, template)` draws into another element

**Breaking.** Six exports leave `@verajs/core`, replaced by `effect`:

| Before | Now |
| --- | --- |
| `useEffect(fn)` | `effect(fn)` |
| `useLayoutEffect(fn)` | `effect(fn, { timing: 'layout' })` |
| `useSyncEffect(fn)` | `effect(fn, { timing: 'sync' })` |
| `useHook(fn, priority, element?)` | `effect(fn, { priority, owner: element })` |
| `createHook({ callback, priority, element })` | `effect(fn, { priority, owner })`, started with `.run()` — scheduled, once per flush. Running INSIDE every write, unbatched, is no longer public; `computed` covers a derived value |
| `useRender(template, element)` | return the render from the setup; to draw into another element, `portal` (below) |

- **`effect` returns the effect itself**: `run()` runs it now, `stop()` ends it for good — its cleanup runs once, it
  leaves every store, and nothing runs it again.
- **`owner`** makes an effect outside a setup — a module's own value, retired by whoever owns it. With no owner and no
  component being set up, it throws (`no-owner`), as the hooks did.
- **`priority`** orders within a flush, lower first (50 is the render); a non-finite one registers nothing, and
  development says why (`priority-not-finite`).

**`@verajs/renderer/portal`** (new): `portal(target, template)`, called in a setup, draws into `target` — a modal on
`document.body` — in a range of its own (any number share a target), in the render's slot (keyed rows follow their
items; layout effects see it drawn), and leaves with its component (a `persist`ing one takes it out while away and draws
it again when back). It draws `target`'s light DOM, never a shadow root, and registers nothing on a server. It keeps
`@verajs/core` external in every build, so the renderer now lists `@verajs/core` as an OPTIONAL peer dependency — only
this entry needs it.
