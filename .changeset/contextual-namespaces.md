---
'@verajs/jsx': minor
'@verajs/renderer': patch
'@verajs/inserts': patch
---

SVG and MathML in JSX are parsed where they land — and buildless JSX loads whole apps

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
browser's own parser, once per parent name, rather than read from a list — so the integration points,
the breakout names and `<annotation-xml encoding>` behave as the parser has them. A hand-written
`` svg`…` `` or `` mathml`…` `` keeps the namespace it was written with. It is 642 B gzipped, and
the renderer without it pays nothing on its render paths beyond a flag check.

**`@verajs/jsx` 0.4.0 — breaking.**

- **Every template is `html`, and every compiled module wires `@verajs/renderer/namespaces`**
  (`import { namespaces } …; import { wire } …; wire([namespaces]);`, prepended). Wiring from every
  module means no JSX template can be built before the resolver exists, whichever chunk loads first;
  wiring the same descriptor again is idempotent. `namespaces: false` opts out, and `inject: false`
  leaves the wiring to the caller along with every other import.
- **Requires `@verajs/renderer` 0.2.3 or later**, the first with the `./namespaces` entry.
- **The `svg` and `mathml` options are removed** — the compiler no longer decides a namespace, so
  there is nothing for them to name.
- **`@verajs/jsx/standalone` is a module loader.** `<script type="text/vera-jsx">` blocks, inline or
  `src`, run as real ES modules, and a file they import — `.jsx` or `.js`, relatively — is loaded
  the same way, so a self-hosted buildless app is ordinary files beside its page and a three-entry
  import map (`@verajs/core`, `@verajs/renderer`, `@verajs/jsx`). The renderer helpers compiled JSX
  imports are found beside wherever the map puts `@verajs/renderer`, so copy the renderer's whole
  `dist` folder. The compiler is loaded only when something must compile, and each file's compiled
  output is kept in `localStorage`, validated by its ETag, so a repeat visit compiles nothing. A
  circular import is reported with its chain, and a missing file names the file that imported it.
  The entry is 1.6 KB gzipped, down from 6.1 KB, plus the 5.5 KB compiler on a visit that
  compiles. It no longer exports `transformJsx`; import that from `@verajs/jsx`.

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
