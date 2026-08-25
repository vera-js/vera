# Features

Source material for how VeraJS gets described publicly.

**Every claim here is measured and reproducible.** Each page states the claim, shows the evidence,
gives the command that regenerates it, and names the honest caveat. Anything published will meet
readers who check — a claim that does not survive checking costs more than not making it.

Numbers were taken on 2026-08-21 against VeraJS 0.1.2, Vue 3.5.41, Solid 1.9.15, Preact 10.29.8 +
signals-core 1.14.4, Lit 3.3.3, Van.js 1.6.1, petite-vue 0.4.1, Alpine.js 3.16.2, React 19.2.8.
Regenerate with `node bench/size.mjs` and `node bench/reactivity.mjs`.

---

## The differentiators

| | Claim | Strength |
| --- | --- | --- |
| [Size](size.md) | <!--size:app.kb-->6.1 KB<!--/size:app.kb--> for a working app — level with Lit, under Preact, 10x under React | **Strong** — measured |
| [Zero dependencies](zero-dependencies.md) | No third-party runtime deps in any of the seven packages | **Strong** — measured, but shared |
| [Buildless](buildless.md) | Works in CodePen with no toolchain at all | **Strong** — architectural |
| [Both effect models](effect-models.md) | Batched *and* per-change effects, plus change metadata | **Strongest** — nobody else has all three |
| [No base class](no-base-class.md) | Attaches to a plain `HTMLElement`; retrofittable | **Strong** — structural, Lit cannot match |
| [Reactivity](reactivity.md) | Automatic tracking; no dep arrays, no property declarations | **Strong** — Solid-class DX without a compiler |
| [Module system](module-system.md) | Genuinely independent modules; 4 extension points | **Medium** — real, but needs explaining |
| [Performance](performance.md) | ~200 ns tracked reads, coalesced effects | **Medium** — good, not category-leading |

## The one-line pitch

> A <!--size:app.kb-->6.1 KB<!--/size:app.kb--> reactive framework on native web components. No build step, no base class, no
> dependencies, no dependency arrays — and the only one that gives you batched *and* per-change
> effects.

## What NOT to claim

Being wrong once in public costs more than every correct claim gains.

- **Not "replaces React".** Nobody migrates off React for bundle size; they stay for the ecosystem
  and the hiring pool. The claim invites judgement on the one axis you cannot win.
- **Not "fastest".** Solid compiles to direct DOM updates; VeraJS re-runs templates and diffs. Its
  update ceiling is Vue/React-class. See [performance.md](performance.md).
- **Not core's standalone size.** Core ships no renderer, so `@verajs/core` on its own cannot put
  anything on screen. The only honest app number is core **plus** a renderer:
  <!--size:app.kb-->6.1 KB<!--/size:app.kb-->.
- **Not "production ready".** One maintainer, pre-1.0, and the browser test layer is still
  pending (the node+jsdom suite and CI are real). Say "early" plainly.
- **Not "the only zero-dependency framework".** Van.js, petite-vue and Preact + signals ship zero
  too, and React ships one. State zero as a property, not a distinction — what is uncommon is
  holding it across a router, an SSR renderer and a JSX compiler rather than a micro-library.
- **Not "smallest".** Van.js is smaller, and Solid is smaller if you accept its compiler. VeraJS is
  **level with Lit** — the two are within a rounding error, currently just above — and under
  Preact. Say *that*,
  name the two exceptions yourself, and quote the measured figure rather than a remembered one;
  this claim has been wrong in both directions.

## Where the positioning should aim

Not at React's territory. The strongest market is **design systems** — the one place
framework-agnostic components are a hard requirement rather than a preference, and where Lit is the
incumbent VeraJS actually competes with. Then **embeddable widgets** and **Astro islands**.

**Not WordPress.** It looks like a fit on paper and is not one: custom tags cannot be used in post
content without breaking Gutenberg.
