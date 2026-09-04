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

**It runs on the default stack** — `wire([renderer, slots, styles])` and core's own `html`, with no
`setHtml` call, because core's tag already produces the shape the renderer accepts. It used to run
on lit-html as its renderer, which predated `@verajs/renderer` and was never moved across; that left
the example for npm + TypeScript exercising a configuration no user has.

Moving it found two things the lit version could never have hit, both of which are the argument for
an example using the default stack:

- `vite.config.js` aliases `@verajs/*` to package **source**, and the source guards diagnostics as
  `if (__DEV__)`. Only the real build folds that to a literal, so the page died on
  `__DEV__ is not defined` — no render, no clue, browser-only. Same again for `__HYDRATING__`. The
  config now defines both.
- Two modules were missing: light-DOM slots (`<parent-element>` renders a `<slot>` without a shadow
  root) and `static styles` adoption, which left core in 0.2.0. Both were found by *reading the
  development diagnostics*, each of which named the module and the exact line to add — which is
  incidentally a fair test of those messages.

**Known leftover:** `hello-component.ts` renders `<sl-image-comparer>`, a Shoelace element that has
never been a dependency here, so the autoloader 404s on every load and two Unsplash images are
fetched from the network. It is left alone pending a decision rather than quietly deleted.

**A note on the remaining files.** This directory predates the project's overhaul and doubles as
its exercise ground: `hello-component` / `goodbye-component` (toggled subtrees over a deliberately
large store), `wcc-single-element` (a template-clone footer from an earlier era), `name-acquire`
and `logic-chunk` are kept as working history rather than curated teaching material. Read the
numbered files above first; treat the rest as a demo app that grew by hand — which is also a more
honest picture of real usage than a polished tour.
