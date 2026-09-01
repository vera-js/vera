# Buildless — CDN + import map

The consumption mode VeraJS treats as its baseline: no bundler, no compiler, no `node_modules`.
An import map points bare specifiers at the standalone `dist/*.min.js` bundles, and everything
else is a `<script type="module">`.

```sh
npm run build          # once, from the repo root — the example serves the real bundles
npm run dev:cdn        # then open the printed URL
```

What to look at, in order:

1. **`index.html`** — the import map. This is the entire "toolchain".
2. **`src/index.js`** — the wiring: `wire([renderer, …])` once, then components load. Note the
   dynamic `import()` for components — static imports hoist above the wiring and would define
   elements before a renderer exists.
3. **`src/components/`** — a counter and a small app, written exactly as the README quick start.
4. **`src/inserts/`** — the three worked extension examples the docs point at: `computed.js`
   (a `'proxy-handler'` insert), `batch.js` (a `'set-handler'` holding writes back), and
   `error-boundary.js` (the `'error'` insert). Each is a few dozen lines and each is executed by
   the test suite (`tests/example-computed.test.mjs`, `tests/example-batch-boundary.test.mjs`).

The npm + TypeScript counterpart of this example is [`../npm-ts/`](../npm-ts/).
