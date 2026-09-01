# npm + TypeScript

The installed consumption mode: bare specifiers (`@verajs/core`), TypeScript sources, Vite in
dev. In this repo the specifiers alias to package sources so the example runs against live code;
for a consumer they resolve through each package's `exports` map.

```sh
npm run dev            # from the repo root; open the printed URL
```

What this example exists to prove, and where:

1. **`src/index.ts`** — the wiring, heavily commented: the router handed core's registry, the
   autoloader configured with `extension: '.ts'` (a dev server will not answer `foo.js` when only
   `foo.ts` exists — the reason the option exists), the `vera:autoload-error` retry pattern, and
   why components load with dynamic `import()`.
2. **`src/components/child-element.ts` / `parent-element.ts`** — structured data flowing through
   a `.item=${…}` property binding, and the **`declare` field rule**: a plain TypeScript class
   field emits an initializer that wipes values bound before upgrade. This pair is the worked
   example of the sharpest TypeScript trap in the framework.
3. **`src/components/jsx-demo.tsx`** — a TSX component compiled by `@verajs/jsx` (see
   `vite.config.js`); still a platform class, zero runtime cost.
4. **`src/components/quantity-picker.ts`** — `static styles` with the `css` tag and custom
   properties.
5. **`src/components/base.ts`** — the router in a component: `initRouter`, routes, an outlet.

This example also runs against **lit-html as the renderer** (`setHtml(html)` +
`wire({ on: 'render', fn: render, priority: 50 })`) — deliberately, so the repo exercises the
renderer-swap path somewhere real. New apps should prefer `@verajs/renderer` and skip both calls.

**A note on the remaining files.** This directory predates the project's overhaul and doubles as
its exercise ground: `hello-component` / `goodbye-component` (toggled subtrees over a deliberately
large store), `wcc-single-element` (a template-clone footer from an earlier era), `name-acquire`
and `logic-chunk` are kept as working history rather than curated teaching material. Read the
numbered files above first; treat the rest as a demo app that grew by hand — which is also a more
honest picture of real usage than a polished tour.
