# @verajs/jsx

## 0.3.2

### Patch Changes

- c9017c1: `key` on a function component type-checks in TSX
  
  `<Card key={id} title="x" />` was `TS2322 — Property 'key' does not exist on type '{ title: string }'`,
  while the same `key` on a dash-named tag was fine and both compiled and ran correctly. The types were
  forbidding a feature the transform implements: `key` is handled in BOTH emitters on purpose —
  `tpl.setKey()` for an element, and the component emitter lifts it out of the props bag before the
  rest become properties — and `packages/jsx/README.md` documents it as working on "element **or**
  component".
  
  The gap was `JSX.IntrinsicAttributes`, which the package never declared. A dash-named tag resolves
  through `IntrinsicElements`' index signature and accepts anything, so nothing in the repo showed it;
  a function component is checked against its own parameter type, and `IntrinsicAttributes` is the
  interface TypeScript intersects into every component's allowed props — where React declares `key`.
  
  `key?: unknown` rather than React's `string | number`: this renderer compares keys by value and
  `TemplateResult.key` is `unknown`, so any identity is legitimate.
  
  Reported by a TSX app that had kept a cast as a workaround. The cast can go.
  
  Now covered by `tests/consumer/tsxcheck.tsx`, which compiles TSX against the SHIPPED declarations
  through the tsconfig the docs tell people to write. The existing consumer check could not reach it —
  the JSX namespace is ambient, so only a file containing JSX exercises it.

## 0.3.1

### Patch Changes

- 3e72abd: A boolean child renders nothing in JSX, and is named in a template
  
  `{items.length > 0 && <em/>}` is the most common JSX conditional, and when the test failed it put
  the word "false" on the page. Each grammar now answers the way its own users expect.
  
  **JSX drops it**, React's rule. The transform filters child expressions — element children and a
  component's children alike — through a module-local helper, so the value reaching the renderer and
  `@verajs/ssr` is `null`, which both already drop: no renderer change, no serializer change, and no
  new import specifier. Only booleans, so `{0 && <x/>}` still renders `0` exactly as React does. A
  module that compiles no JSX children carries none of it, and the helper steps aside if your module
  already uses the name.
  
  **A template keeps lit's behaviour exactly** — anything not nullish renders — and development now
  names a boolean child at the binding, once per distinct value. That is the one value semantic on
  which JSX and a hand-written template differ, so the warning is also what meets JSX-shaped code
  pasted into a template. Production carries neither the check nor the message: the renderer bundle
  is byte-identical.
  
  Measured: the filter's cost is below the noise floor in all three engines.

## 0.3.0

### Minor Changes

- 4bfee3e: On a component tag, a bare prop is a prop — and SVG/MathML content just works
  
  Two changes to what JSX compiles to on dash-named tags, both breaking on that surface (0.x rules:
  minor).
  
  **Bare props are props**, React's own semantics: `<calendar-day date={d} count={3} active>` emits
  `.date=${d}`, `.count=${3}`, `.active=${true}` — properties by identity, adopted reactively by
  `init()` with nothing declared, delivered to the child's server render by `@verajs/ssr`. Bound,
  literal and bare-flag values alike, in the build plugin and the buildless standalone path both. No
  name table decides what qualifies: a name that cannot be a JS identifier (`data-*`, `aria-*`,
  `xlink:href`) has no property spelling by construction and stays an attribute, and `class`/`for` —
  the two names the DOM itself renamed — stay attributes (write `className`, as in React). The
  HTML-control guesses (`value`/`checked`, the boolean table, `default*`) no longer reach a
  component: `disabled={x}` is the component's own prop, never a `?disabled` toggle. HTML tags are
  untouched. Previously a bare bound attribute on a dashed tag was an attribute — an array arrived
  as `"1,2,3"`; that spelling now delivers the array.
  
  **Expressions inside `<svg>`/`<math>` compile their roots in the right namespace.** A map
  callback's shapes inside `<svg>` compiled as `html\`\`` and parsed as HTMLUnknownElements that
  never drew — and JSX had no `svg\`\`` of its own, so no spelling worked. The surrounding element
  now decides, lexically: `<svg>` children compile with core's `svg` tag, `<math>` with `mathml`,
  `<foreignObject>` flips back to HTML, imports injected like `html`'s. One boundary: a function
  component compiles where it is defined, so give an icon component its own `<svg>` wrapper or
  define the shape inline.

## 0.2.0

### Minor Changes

- d55c8b5: The conventions port: TypeScript source, the standard build, one delivery rule. The package now
  ships `dist/` like every other (`development`/`default`/`types` conditions; generated
  declarations replace the hand-written `types.d.ts` that could drift from the code it described).
  BREAKING (the 0.x minor): the default export is gone — `import { veraJsx } from '@verajs/jsx'`;
  deep `src/` paths no longer exist — the browser standalone is
  `https://cdn.jsdelivr.net/npm/@verajs/jsx@<released version>/dist/vera-jsx-standalone.min.js (llms.txt pins the live version)` (llms.txt's
  buildless recipe already teaches the new path, so this version must publish for that recipe's
  CDN copy-paste to resolve).
- 29cc8db: `keyed()` moves to `@verajs/renderer/keyed`
  
  Keyed list reconciliation is the largest single algorithm in the renderer and most apps never
  reorder a list, so it is now its own entry. An app that does not import `keyed` is **365 B gzipped
  smaller**; one that does pays **34 B** over having it built in.
  
  ```js
  - import { render, keyed } from '@verajs/renderer';
  + import { render } from '@verajs/renderer';
  + import { keyed } from '@verajs/renderer/keyed';
  ```
  
  Buildless pages need the specifier in their import map. `@verajs/jsx` now injects the new path when
  it compiles a `key={}`; pass `keyed: ['keyed', '@verajs/renderer']` to `transformJsx` to keep the
  old one.
  
  Nothing registers and there is no `wire()` call: `keyed()` stamps each result with the strategy that
  reconciles it, so the algorithm travels with the values that need it and a list always names its own
  reconciler. The entry is **additive** — it imports nothing and reaches whatever renderer is present
  through mangling-exempt members — so it is safe alongside `/hydrate`, unlike the superset entries.

### Patch Changes

- dd76fb8: Every published package declares `engines: node >= 20`
  
  No published package declared an `engines` field at all, so a consumer was told nothing about which
  Node this is built for. The root's `>=18.15.0` looked like the answer and was not: the root is
  private and never published, so it governed only this repo's own development.
  
  It was also not true. Node 18 reached end of life in April 2025, CI has only ever run Node 24, and
  nothing has verified an 18 install in a long time — so the floor was a claim nobody was checking.
  Declaring the one we actually test is a fix rather than a restriction, and it is what lets
  `@verajs/ssr` use the `crypto.randomUUID()` that has been global since Node 19.
- e7e56f5: A dead-code and consistency sweep from the full-line read — no behaviour changes
  
  Every removal was verified unreachable before it went: core's `runHooks` kept an optional call on a
  value already guarded, and `runCallbacks` re-fetched through two map lookups the very set it was
  iterating; the ssr serializer's final `raw` ternary sat below the early return that makes it
  unreachable, an entity-table entry could never match its own regex branch, and the fragment parser
  carried a variable it only ever `void`ed; the JSX transform now initialises `usedSpread` beside its
  two siblings instead of relying on undefined-is-falsy.
  
  Also in `@verajs/ssr`: the Set-diff that recovered "the entry `setRenderer` registered" around the
  `wire()` call was a leftover from an API that registered a wrapper. `wire` registers the function it
  is handed, so the renderer-displacement guard now asks the chain for `serverRenderer` by identity —
  same check, two lines and one allocation fewer, and the comments above it stop teaching a removed
  API.
  
  Net −16 B gzipped on `@verajs/core`; size claims re-synced.
- eb35664: Move `spread` into `@verajs/renderer/spread`. **Breaking:** `@verajs/spread` is retired.
  
  ```js
  - import { spread } from '@verajs/spread';
  + import { spread } from '@verajs/renderer/spread';
  ```
  
  Nothing about the implementation changes. It extends the renderer's template language and speaks the
  renderer's `_$apply$` protocol, so a separate top-level name put it where nobody would look for it.
  A package earns its own name when it is a capability you install on purpose; a primitive extending
  something else's surface belongs as an entry in that thing.
  
  It is the one renderer entry that is **additive** rather than a substitute. The others inline
  `./renderer.js` and carry their own template cache, so two must never load together; this one
  imports nothing at all and is safe alongside any of them.
  
  `@verajs/jsx` emits the new specifier for `{...props}`, configurable as before.

## 0.1.3

### Patch Changes

- fbfc58f: Support `<div ${spread(props)}>` — bindings whose names are not known when the template is parsed.
  
  New package `@verajs/spread`. Template renderers bake attribute names in at parse time, which is
  what makes them small and fast and why neither this renderer nor lit-html has had spread; lit's PR
  has been an open draft since 2021.
  
  `@verajs/renderer` gains a protocol rather than a feature: a value at element position carrying
  `_$apply$` applies itself, in 16 B, confined to the element position so nothing lands in the text,
  attribute or property commits the benchmarks measure. An in-renderer implementation measured 176 B.
  
  `@verajs/jsx` now compiles `{...props}` on an element to `${spread(props)}` and injects the import,
  where it used to be a compile error. `@verajs/ssr` serializes a spread: attributes, truthy booleans
  and the form properties reach markup; events and other properties are client state. The escaping
  stays entirely in `@verajs/ssr`, so a new binding source cannot introduce a second escape boundary.
  
  Removing a key restores what the element held before the binding existed, rather than guessing at a
  value that means absent — for a property there is none. On a hydrated page that means the server's
  markup; bind `null` to remove instead.
  
  Runtime is at parity with writing the bindings out.

## 0.1.2

### Patch Changes

- Fix a renderer crash, and ship the license text.
  
  **Renderer.** `ChildPart._clear()` could walk off the end of the child list and throw
  `Cannot read properties of null (reading 'nextSibling')`, aborting the render pass and leaving a
  half-updated DOM. `TextPart` upgrades to a `ChildPart` on its first non-primitive value, and it
  borrowed `this._text.nextSibling` as its exclusive end — a node owned by the *next* part, which
  that part removes when it upgrades and clears its own text. The upgrade now inserts its own end
  marker, so a part owns both anchors and `_end === null` means only "root part", which makes the
  `textContent = ''` fast path sound. The removal loop also stops at the end of the child list
  rather than throwing, so a broken invariant degrades into a missed removal.
  
  Triggered by several sibling child-expressions in one parent each toggling between a template and
  `''` — a shape any conditional-heavy template can reach. Costs 19 bytes gzipped and nothing
  measurable in the DOM benchmarks. Covered by `tests/renderer-sibling-parts.test.mjs`.
  
  **Licensing.** Every package now ships the MIT `LICENSE` text rather than only declaring `"MIT"`
  in its manifest, and `author` names a person.

## 0.1.1

### Patch Changes

- 5228f8d: Pin the canonical `git+https://` form of `repository.url`.
  
  npm normalizes this field on publish, and the registry compares the normalized
  value against the provenance statement's source repository — a mismatch is
  rejected with a 422. Carrying the normalized form in the manifest removes the
  dependency on auto-correction.
  
  This is also the first release published from GitHub Actions via npm Trusted
  Publishing, so these are the first `@verajs` tarballs to carry a provenance
  attestation.
