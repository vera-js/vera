# Components: every one, in the states it ships with

One page with a plate per component package, each running its production bundle through an import map, no build step
of its own:

```sh
npm run build           # once, from the repo root: the page runs the real bundles
npm run dev:components  # then open the printed URL
```

Each plate comes from the package's own `src/<name>/demo.ts`: what the component asks you to judge, and each state it
ships with, as markup. `index.html` is generated from those and `template.html` by
`node scripts/build-components-page.mjs`, which follows each bundle's bare imports through the packages' `exports` to
write the import map; it is committed, so any static server opens it, and the gate's `--check` fails when it no longer
matches the demos. A new component with a demo appears here at the next regeneration.

What to look at: the import map in the page source (what a CDN page writes by hand), and each component's states as a
user meets them. The same states are rendered in jsdom by `tests/component-demos.test.mjs`, which is red when one says
anything on the console, and `tests/browser/example-pages.test.js` loads this page and operates its dialogs.
