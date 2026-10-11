---
'@verajs/core': minor
'@verajs/renderer': patch
---

A component is one setup that returns its render — `render()` and `mount()` are removed

**Breaking.** `init` takes the component's setup as its second argument. The setup runs once, untracked, and returns
the function that draws; that function is the only part that re-runs when state it read changes:

```js
class ClickCounter extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      const state = createStore({ count: 0 });
      return () => html`<button @click=${() => state.count++}>Clicked ${state.count} times</button>`;
    });
  }
}
```

Migrating:

- **`render(fn)` becomes `return fn`** from the setup: move everything between `init(this)` and `render(…)` into a
  function, `init(this, () => { …; return () => html`…`; })`. A template passed to `render` directly (not a function)
  was drawn once; return `() => view` for the same result.
- **`mount()` goes.** A setup that returns nothing is a side-effect setup: its effects run and it draws nothing.
- **The options travel with the host.** `init(this, { mode: 'open' })` becomes `init({ host: this, shadow: 'open' },
  setup)`; `shadow` is `'open'`, `'closed'`, `false` (light DOM) or a `ShadowRootInit`. An old call still runs — the
  object is ignored in every build, so it sets up with no shadow root — and development names the new spelling once
  (`init-options`); TypeScript refuses it at build time.
- **Extra arguments to `render(template, …args)`** were forwarded to the renderer, which never read them. Capture
  anything the render needs in the setup instead. `useRender(template, element)` takes exactly two.
- **`useRender` returns nothing (`void`)**, as its docs always said. Its TypeScript type had declared the hook it
  registered (`HookCallback | undefined`), and calling that ran a render pass by hand; a render re-runs when state it
  read changes, so write to that state instead.
- **A class can keep a method.** `init(this)` with no setup calls `this.setup()`, so
  `connectedCallback() { init(this); }` plus `setup() { …; return () => html`…`; }` is the same component.
  `init({ host: this, shadow: 'open' })` does the same with a shadow root. Development names a near-miss
  spelling (`setUp`, `Setup`, `set_up`) once.
- **An async setup is atomic.** Its hooks must be registered before its first `await` — one after it throws
  `no-owner`, as before. Nothing it registered runs until it resolves, a write while it is pending does not re-run
  it, and a rejection is reported once through the error chain and commits nothing.

`renderer({ shadow })` sets the app's default root — `wire([renderer({ shadow: 'open' })])` — which a component's own
`shadow` overrides. The same `wire` call works unchanged on the server, where `@verajs/ssr` keeps its own renderer
and learns the default from it.

A removed component now leaves nothing behind in a store it read: each hook unsubscribes exactly the keys it joined,
with no sweep, and an element set up again in place runs its previous setup's effect cleanups first.
