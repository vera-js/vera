---
'@verajs/jsx': patch
'@verajs/renderer': patch
---

SVG shapes handed to a component draw, and a hand-written one that cannot is named

```jsx
const Frame = ({ children }) => <svg viewBox="0 0 24 24">{children}</svg>;
<Frame><path d="M0 0h24" /><circle cx="12" cy="12" r="4" /></Frame>
```

built its shapes as HTML. `<path>` parsed as HTML is an `HTMLUnknownElement` — right tag name, no
geometry, nothing drawn — so an entire header of icons vanished for the app that reported it, with
nothing to search for. Shapes inside the same `<svg>` always worked; ones handed to a wrapper did
not.

**`@verajs/jsx`: a template whose ROOT is an SVG-only element compiles with the `svg` tag.** Mode
tracking is lexical and stops at a function boundary, so children written at a call site were
compiled where they were written. The call site cannot know what `Frame` renders and does not need
to: `<path>` is not an HTML element in any context, so parsing it as HTML was never what anyone
meant. This covers children passed directly, through a `<>…</>` fragment, and through a mapped list.

A root is refused whenever a component or custom element lies in its children or an expression
child, and whenever an ATTRIBUTE carries JSX at all — the upgraded mode propagates into a handler,
and that handler's template goes wherever the handler puts it, which the shape around it cannot
know. `<circle onClick={() => open(<form><input/></form>)}/>` would otherwise build a real form in
the SVG namespace: not an `HTMLInputElement`, no form semantics, and silent. An SVG-namespaced
custom element never runs its `connectedCallback`, silently.

`<foreignObject>`, `<desc>` and `<title>` are SVG's HTML integration points, and all three are
exempt: their content parses as HTML there, so an element or a component beneath one is safe and
the shape around it still draws. The island's own ATTRIBUTES are still checked, since those are
emitted in the outer namespace.

The one shape an island cannot take is a STATIC element inside a `<title>`. `@verajs/renderer` scans
`<title>` as raw text in every template, by one rule deliberately shared with its parsed-tree pass,
so an element written there is dropped, a binding's sigil is left behind as a dead attribute, and a
spread throws. An EXPRESSION never reaches that — it becomes its own template, committed as a child,
never scanned as `<title>`'s statics. So `<g><title>{label}</title><path /></g>` upgrades and draws,
`<g><title>{flag && <my-badge />}</title><path /></g>` upgrades and the badge still upgrades as a
custom element, and only `<g><title><tspan /></title></g>` keeps the behaviour it had.

MathML's token elements (`<mi>`, `<mo>`, `<mn>`, `<ms>`, `<mtext>`) are the equivalent for CHILD
MODE — an expression inside one compiles `html`. They never exempt a root from refusal, because a
root is only ever upgraded to `svg`: inside an `svg` template a `<math>` does not switch namespace,
so an `<mtext>` there really is SVG.

**A SIBLING vouches for a name a root tag alone cannot prove.** `<title>` is the canonical case and
the one that mattered: SVG shares the name with HTML, so it is never upgraded on its own — but a
component's children are emitted as separate roots, so

```jsx
<Frame><title>{label}</title><path d={d} /></Frame>
```

built the `<title>` as HTML inside the `<svg>`, where it is the accessible name of nothing. The
`<path>` beside it settles the question: one SVG-only name in a sibling group puts the group in SVG,
so the names excluded only because *a root tag alone cannot prove context* — `title`, `a`, `style`,
`script`, `image`, `font`, `text`, `tspan`, `desc`, `metadata`, `switch`, `view`, `set`, `filter`,
`mask`, `marker`, `pattern`, `symbol` — come with it. Alone they are untouched, so
`<Box><text>hello</text></Box>` is still readable text and not a 0×0 SVG element. An expression vouches through its own roots, so a mapped list of
shapes counts; one that mixes namespaces or yields nothing knowable does not. The vouch travels both ways: a sibling also settles what an
expression's own roots compile as, so `<Frame><path />{labels.map((t) => <text>{t}</text>)}</Frame>`
gives every `<text>` the group's namespace.

The camelCase names stay out even here. Their hazard is not the root-tag one: `@verajs/ssr` emits the
strings verbatim and a browser lowercases them outside an `<svg>`, so hydration would discard and
rebuild. A sibling says what the group IS, not where it lands.

An opaque runtime value is untouched: a `TemplateResult` arriving through an expression carries its
own tag, and the renderer names it if it is wrong.

Three kinds of name are excluded, and every omission is conservative — they fall back to the previous
behaviour rather than mis-tagging anything.

The ones SVG shares with HTML (`a`, `script`, `style`, `title`, `image`, `font`), because guessing
there would break real HTML.

The ones that carry visible content as an unknown HTML element (`text`, `desc`, `foreignObject`,
`tspan`, `switch`, `filter`, `mask`, `marker`, `pattern`, `symbol`), because the upgrade fires on the
root tag alone and so also applies to a template bound for an HTML parent — `<Box><text>hi</text></Box>`
would go from readable text to a 0×0 SVG element, which is a regression of working output rather than
a missed fix.

And the camelCase ones (`clipPath`, `linearGradient`, `radialGradient`, `animateTransform`,
`animateMotion`), which a server emits verbatim while a browser parses them lowercased outside an
`<svg>` — hydration would then discard the server's markup and rebuild.

All of these are almost always written inside an `<svg>` anyway, where lexical position already
answers.

`svg` itself is excluded too: a template already rooted at `<svg>` needs no tag, which is why
`` html`<svg><path/></svg>` `` has always worked.

**An injected import no longer collides with a name the module binds.** The root upgrade makes
ordinary icon JSX inject `svg`, where before only a template written inside an `<svg>` did — so
`const svg = …`, `const { html, svg } = vera`, `const [svg] = …` or a parameter named `svg` beside a
`<path />` made the whole module a `SyntaxError`, caught and logged in a browser, leaving the page
doing nothing. The import is now renamed instead (`import { svg as $veraSvg }`), exactly as the
child helper already stepped aside. A module that never mentions the name keeps the plain one, and
one that hand-writes `` html`…` `` beside its JSX keeps it too, since that is a reference to the
import being added rather than a collision with it. The hole was always there for `html`; this is
what made it reachable.

Costs nothing on a page — the transform runs at build time, and only the buildless
`@verajs/jsx/standalone` bundle carries the bytes.

**`@verajs/renderer`: development names what no compiler can reach.** A HAND-WRITTEN `html` template
handed across a function boundary into an `<svg>` or `<math>` — `` Frame(html`<path/>`) `` — is still
HTML, and still correct to write as `` svg`…` ``; the call site simply has no way to know the
destination. lit-html behaves identically, so the behaviour is not the thing to change — the silence
is. Development now names the element and which tag to use.

The rule is namespace MISMATCH, not "is HTML", so it catches the mirror case too: a hand-written
`` mathml`…` `` handed into an `<svg>` is the same mistake one namespace over, and it drew nothing
and said nothing while the check looked for HTML specifically. The message names the namespace the
element was actually built in. SVG's `<foreignObject>`/`<desc>`/`<title>`
and MathML's token elements are HTML integration points and stay silent, because HTML inside them is
correct, and `<style>`/`<script>` are silent because neither draws — an HTML `<style>` inside an
`<svg>` applies its rules perfectly well, so "will not render" would be both wrong and exactly the
guess the compiler refuses to make. It is raised from the template, list and keyed-list commit
paths — including the batched one a growing icon list takes — and named once per host namespace,
host name, content namespace and tag, so the same real mistake is reported once while an HTML `<a>`
and a MathML `<a>` in one `<svg>` stay two distinct mistakes.

Two insertion paths are NOT covered, and that is worth knowing rather than discovering: hydration
commits its nodes through its own cursor, and `@verajs/renderer/slots` moves assigned light children
into place itself — that entry imports nothing by design, which is what makes it safe beside any
renderer on a CDN page.

HTML content in a foreign parent gets both remedies, because which is right depends on what the
element was meant to be: `` svg`…` `` fixes an SVG element compiled as HTML, while genuinely HTML
content needs an HTML island — `<foreignObject>` in SVG, `<mtext>` in MathML — tagging a custom element `` svg`…` `` would silence the warning and
leave it permanently un-upgraded. **The limit of deciding this at compile time, stated plainly.** The tag is chosen from the root name;
where the template LANDS is only knowable at runtime. An upgraded template is right in an `<svg>` and
differs from its old behaviour in an HTML parent:

- its whole statically-visible subtree becomes SVG, so `<g><button>…</button></g>` is an SVG button;
- a breakout name is relocated — `<g><p>hi</p></g>` parses as `<g></g><p>hi</p>`, siblings rather
  than nested, so the template gains a second root;
- `@verajs/ssr` serialises the strings and lets the browser's parser assign the namespace, so for a
  destination in HTML the server's markup and a client render can differ in casing or in structure.

**That last one has a real cost, and it is worth stating exactly rather than waving away.** An
un-upgraded `<g>` is an `HTMLUnknownElement`, which never draws as SVG — but an `HTMLUnknownElement`
renders its CHILDREN perfectly well. So `<Box><g><button>Press</button></g></Box>` was a working
`HTMLButtonElement` and becomes an inert SVG-namespaced one. The `<g>` gains nothing there and the
button loses everything.

The trade is still the right way round, on frequency rather than on principle: `<g>` outside an
`<svg>` is markup that means nothing to begin with, while shapes handed across a component boundary
into an `<svg>` are the common case and the one that cost an app its entire icon set. Measured
across 6 000 corpus templates, the change REDUCES
client/SSR namespace disagreement for destinations inside `<svg>` and increases it for destinations
in a `<div>`, which is the same trade seen from the other side. Put genuinely HTML content in a
`<foreignObject>`.

No code and no strings survive minification — the check, its strings and its call
all fold away.

Inferring the namespace from the DOM parent instead was built, measured and rejected: a part resolves
its position while still inside the off-document fragment it is being built in, so a mapped list or a
fragment-rooted binding answered "not SVG" and cached it for the life of the page — order-dependently,
since an empty first render gave the other answer. It also cost 203 B gzipped on the renderer and
made client render disagree with hydration.
