# @verajs/jsx

## 0.4.1

### Patch Changes

- 8331ce8: `@verajs/jsx/standalone` keeps nothing in `localStorage` on a page that serves
  `<meta name="vera-jsx-cache" content="off">`, and compiles on every visit instead. The kept output is storage any
  script on the origin can write, and it runs on later visits; the README now says so, and how to turn it off.

## 0.4.0

### Minor Changes

- 194266a: SVG and MathML in JSX are parsed where they land — and buildless JSX loads whole apps
  
  ```jsx
  const Frame = ({ children }) => <svg viewBox="0 0 24 24">{children}</svg>;
  <Frame><path d="M0 0h24" /><circle cx="12" cy="12" r="4" /></Frame>
  ```
  
  built its shapes as HTML. `<path>` parsed as HTML is an `HTMLUnknownElement` — right tag name, no
  geometry, nothing drawn — so an entire header of icons vanished for the app that reported it. The
  call site cannot know what `Frame` renders, and JSX has no `` svg`…` `` to reach for, so no spelling
  worked.
  
  **`@verajs/renderer/namespaces`: a template is parsed in the namespace of the position it lands
  in.** Wire it — `wire([renderer, namespaces])` — and an `html` template placed inside an `<svg>` is
  SVG, inside a `<math>` is MathML, and inside a `<foreignObject>` or a `<div>` is HTML, exactly as the
  same markup written inline there would be. Which position means which namespace is asked of the
  browser's own parser, once per parent name (and, under a MathML parent, per child tag — `<svg>` in
  `<annotation-xml>`, `<mglyph>` in `<mi>`), rather than read from a list — so the integration points,
  the breakout names and `<annotation-xml encoding>` behave as the parser has them. A hand-written
  `` svg`…` `` or `` mathml`…` `` keeps the namespace it was written with. It is 742 B gzipped, and
  the renderer without it pays nothing on its render paths beyond a flag check.
  
  **`@verajs/jsx` 0.4.0 — breaking.**
  
  - **Every template is `html`, and every compiled module wires `@verajs/renderer/namespaces`**
    (`import { namespaces } …; import { wire } …; wire([namespaces]);`, prepended). Wiring from every
    module means no JSX template can be built before the resolver exists, whichever chunk loads first;
    wiring the same descriptor again is idempotent. `namespaces: false` opts out, and `inject: false`
    leaves the wiring to the caller along with every other import.
  - **Requires `@verajs/renderer` 0.3.0 or later**, the first with the `./namespaces` entry.
  - **The `svg` and `mathml` options are removed** — the compiler no longer decides a namespace, so
    there is nothing for them to name.
  - **`@verajs/jsx/standalone` is a module loader.** `<script type="text/vera-jsx">` blocks, inline or
    `src`, run as real ES modules, and a file they import — `.jsx` or `.js`, relatively — is loaded
    the same way, so a self-hosted buildless app is ordinary files beside its page and a three-entry
    import map (`@verajs/core`, `@verajs/renderer`, `@verajs/jsx`). `import()` in any form — a template
    literal, a computed path, a full same-site URL, with options — `import.meta.url`,
    `import.meta.resolve`, a JSON or CSS module and a file behind a redirect all resolve as written, and
    a package name in them resolves through the map exactly as from the file itself. Any `@verajs/renderer/<entry>` —
    the helpers compiled JSX imports, and `slots` or `tag` if the app imports them — is found beside
    wherever the map puts `@verajs/renderer`, so copy the renderer's whole `dist` folder. The
    compiler is loaded only when something must compile, and each file's compiled output — an inline
    block's too — is kept in `localStorage` and reused only for the exact text it came from (a
    fingerprint of the file, not a server header), so a repeat visit compiles nothing on any static
    server; a plain `.js` file keeps only where its imports are, never its text. A circular import is reported
    with its chain, a missing file names the file that imported it, and a renderer helper missing
    from beside the renderer is named. The entry is 2 236 B gzipped, down from 5 933 in 0.3.2, plus
    the 5 737 B compiler on a visit that compiles. It no longer exports `transformJsx`; import that from `@verajs/jsx`.
  
  **Fixed in the compiler along the way** — each of these produced a module that died or silently
  lost its JSX:
  
  - an injected import is renamed around a name the module already binds — a destructured binding, a
    second declarator, a parameter, a TypeScript annotation — instead of colliding with it;
  - `import html from './x'` from another module is a binding, not the tag;
  - string, template-literal and regular-expression contents are never read as code, including a
    nested template literal and a regex at statement position;
  - a TypeScript postfix `!` ends an expression, a keyword before `!` is a prefix, and a TSX type
    parameter list (`<T extends object = {}>`) is never markup;
  - `hidden=""` and a literal `checked` mean true, an empty attribute expression is an error with a
    position, and an injected import goes under a hashbang rather than above it;
  - `<annotation-xml>` is not a custom element though its name has a dash, so its `encoding` stays an
    attribute the parser can read.
  
  **`@verajs/renderer`: development names a namespace mismatch.** An element built in one namespace and
  placed where the parser would have used another — a hand-written `` html`<path/>` `` handed into an
  `<svg>` with the resolver not wired, or a `` mathml`…` `` in an `<svg>` — is named once, with the
  remedy that fits it. Nothing of it survives minification.
  
  **`@verajs/inserts`: a `'template'` insert point**, called once when each template is built, which is
  how `@verajs/renderer/namespaces` plugs in.
- c7ab5fc: JSX `value` and `checked` are controlled: compared with the control's live state
  
  `value={x}` compiled to `.value`, which compares with the last value rendered — so a value reset before the next render
  (typing, then a submit handler setting it back to `''` within one frame) rendered `''` twice, wrote nothing, and left the
  user's text in the box. `value`/`checked` now compile to `!value`/`!checked`, which write whenever the control
  disagrees, as React's controlled inputs do; `@verajs/renderer/tag`'s runtime name table (a tag used as a JSX component)
  maps them the same. An explicit `.value={…}` is unchanged.
  
  **Breaking for one pattern:** as with React, a bound `value` the component never updates on input is now restored by the
  next render — `<input value={initial}>` with no input handler used to keep what was typed. The compiler now says so, once,
  with the file and position: a new `onWarning` option of `transformJsx` hears it, the Vite plugin reports it through Vite,
  and the buildless loader prints it in development. Use `defaultValue` for an initial value, `readOnly` for a fixed one,
  or keep the value in step with `onInput`/`onChange`.

### Patch Changes

- c7ab5fc: A comment among a JSX element's attributes is dropped, as TypeScript, Babel and esbuild drop it
  
  `<button type="button" /* note */ class="x">` — or a `// why` line above one attribute of a long element — left that
  element as raw JSX with no warning, and the bundler then failed on it with an unrelated parse error. Comments are now
  skipped anywhere between attributes (beside `=`, before `>` and `/>` too), and an unterminated `/*` there is reported
  with the file and position instead of passing the element through.
- fd55cb2: TSX event handlers on built-in elements infer their event, so `onClick={(e) => …}` compiles under `strict`
  
  Every element's props were one `Record<string, unknown>`, so an inline handler had nothing to infer
  from and `strict` rejected it with TS7006 — every handler had to name its event and cast
  `currentTarget` by hand. Handlers on HTML, SVG and MathML elements are now typed from TypeScript's
  own DOM library: `onInput={(e) => e.currentTarget.value}` is an `InputEvent` on an
  `HTMLInputElement`, and `onClick` a `PointerEvent`.
  
  - Both `onKeyDown` and `onKeydown` are typed; the compiler lowercases whatever follows `on`, so
    every casing binds the same event.
  - A handler may be anything the renderer accepts: a function (called with the element as `this`),
    a `{ handleEvent }` object, or `false`, `null` or `undefined` for none — `onClick={open && close}`
    type-checks.
  - An `on…` name the DOM library does not know, such as a custom event, gets a plain `Event`, as
    `addEventListener` does. A handler declared ahead with a narrower type, `(e: MouseEvent) => …`,
    still fits.
  - A number or a string where a handler belongs is now an error. Nothing else changes: other props
    stay permissive, custom elements accept anything, and declaring your own elements' props by
    merging into `JSX.IntrinsicElements` works as before.
  
  Types only — no runtime change, no bytes.

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
