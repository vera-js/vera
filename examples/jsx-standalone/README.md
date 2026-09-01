# JSX in the browser — no build step

The CodePen recipe as a single file: `<script type="text/vera-jsx">` blocks transformed at page
load by `@verajs/jsx/standalone` — the same zero-dependency parser the Vite plugin uses.

```sh
npm run build          # once, from the repo root — the import map points at the real bundles
npx vite               # then open /examples/jsx-standalone/
```

Everything is in `index.html`: the import map (note the `@verajs/renderer/keyed` entry — `key={…}`
emits an import from that subpath), the standalone script tag, and a small app with function
components, keyed lists and events. The comment at the top shows the jsdelivr URLs to swap in for
a real CodePen. The full recipe, with the rules that trip up code generators, is the
"Buildless JSX" section of [`llms.txt`](../../llms.txt).

Playground path only: real builds prefer the Vite plugin, which ships zero transform code.
