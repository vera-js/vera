---
'@verajs/core': minor
---

Add `commit()` — end a component's setup without rendering.

`render()` does two jobs: it declares what to draw, and it commits the setup by running the first
pass of every hook registered since `init()`. A component whose whole job is a side effect —
analytics, syncing, focus management, a store subscription — has nothing to draw, and previously had
to write `render(() => html``)` to get its effects to run at all. Forget that and nothing happens:
the hooks exist and nobody runs them.

```js
connectedCallback() {
  init(this);
  useEffect(() => track(session.page));
  commit();
}
```

Committing automatically after `connectedCallback` was built first and rejected. It would have run a
headless component's effects a microtask later than a rendering component's — the same code with two
orderings depending on whether it drew anything — and it measured larger (+31 B against +25 B). One
timing rule is worth more than the saved line.

Development also warns when neither `render()` nor `commit()` is called, naming the component and
the hook count. Detected without carrying any state, since both clear the current instance; the
check can miss a case when another component mounts first, but cannot invent one. Production carries
neither the check nor the message.
