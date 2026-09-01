# SSR — Node, vera-native, zero dependencies

The smallest complete server-side rendering round trip: one component, rendered to declarative
shadow DOM by `@verajs/ssr`, served, and hydrated in the browser by `@verajs/renderer/hydrate`.

```sh
npm run build          # once, from the repo root
npm run dev:ssr        # starts server-native.mjs; open the printed URL
```

What to look at:

1. **`server-native.mjs`** — the whole server. `renderToString(url, options)` in, HTML out; note
   the import order (`@verajs/ssr` before anything that imports the renderer) and that the page
   shell places the returned `styles` and `title` itself.
2. **`components/hello-ssr.js`** — an ordinary component. Nothing in it knows about the server;
   the same file renders client-side.
3. **View source in the browser** — declarative shadow DOM (`<template shadowrootmode>`), no
   framework comment markers, readable before any JavaScript runs. Then watch the client adopt it
   rather than re-render: `tests/ssr-example-server.test.mjs` runs this same round trip in CI.

The full-application version of this — routing, slots, lazy loading, one wiring file shared by
server and client — is [`../kitchen-sink/`](../kitchen-sink/). The SSR semantics and limits live
in [`packages/ssr/README.md`](../../packages/ssr/README.md).
