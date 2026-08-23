---
'@verajs/core': patch
---

`render()` with no template commits a component's setup without drawing anything.

It has always done two jobs — declare the markup, and end the setup by running the first pass of
every hook registered since `init()`. A component whose whole job is a side effect (analytics,
syncing, focus management, a store subscription) has nothing to draw and had to write
`render(() => html``)` to get its effects to run at all: ceremony that pretends to draw. Forget it
and nothing happens, silently — the hooks exist and nobody runs them.

```js
connectedCallback() {
  init(this);
  useEffect(() => track(session.page));
  render();
}
```

Existing light DOM is untouched, since nothing renders into it.

Two alternatives were built and measured first. A separate `commit()` cost 25 B against 6 B and
added a second function to choose between. Committing automatically after `connectedCallback` cost
31 B and ran a headless component's effects a microtask later than a rendering component's — the
same code with two orderings depending on whether it drew anything.

Development also warns when `render()` is never called, naming the component and its hook count.
Detected without carrying any state, since `render()` clears the current instance; the check can
miss a case when another component mounts first, but cannot invent one. Production carries neither
the check nor the message.
