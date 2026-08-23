# Code Principles

The bar every change in **VeraJS** must clear. These nine principles are the definition of "good"
for this codebase — reviews, audits, and new work are measured against all of them.

**All nine are equally important. None outranks another.** Do not trade one away to maximize
another. When two genuinely pull against each other on a specific change, **do not silently pick a
winner**: implement the option you believe is best *and surface the trade-off* to the developer — the
concrete benefit (*why*), where it lives (*where*: file / function / boundary), and the mechanism
(*how*) — so they decide. A change "passes" only when it satisfies all eight, or every deviation is
explicitly agreed with the developer.

This document expands each principle into the concrete, project-specific rules that make it real here.
It complements — never overrides — `CLAUDE.md` (the operational conventions and project parameters)
and the rest of `docs/` (audits and the accumulated *why* behind specific decisions). Precedence for
any single change is always: the developer's explicit instruction → the project's existing system
(`CLAUDE.md`, `docs/`, established patterns) → these principles → your own judgment.

> **Context.** VeraJS was built solo, by hand, before AI agents existed. The tooling grew out of one
> person's head under time pressure, and a lot of the tree is frank experimentation. That is
> acknowledged, not defended — the project is heading into a deliberate overhaul, and eventually a
> viability audit (see `CLAUDE.md`). Treat existing patterns as *evidence of intent*, not as proof of
> correctness: follow them where they are sound, and surface them where they are not.

---

## 1. Follows project conventions (`CLAUDE.md`)

Organization, cleanliness, and consistency are a **top priority, not a nicety**. New code must be
indistinguishable in style from the code around it.

- **Before writing anything, find how the codebase already does the same kind of thing** — file
  placement, naming, module boundaries, where state lives, how a hook is registered — and follow that
  exact pattern.
- **Every piece of logic lives in a purpose-named file inside the correct package.** A package's
  `src/index.ts` only *re-exports*; it never holds feature logic. Never scatter standalone helpers
  into entry points or catch-all files. The repo root is for configuration **only** — no source, no
  bundles, no experiments, no documentation beyond `CLAUDE.md` and `README.md`. (The root previously
  held 20 loose files; that is the failure mode this rule exists to prevent.)
- **Naming/structure conventions:** one concern per file, named for the thing it exports
  (`createStore.ts`, `useEffect.ts`); shared types in `@verajs/shared-types`, shared helpers in
  `@verajs/shared-utils`; the `filename` field in each `package.json` drives every build output name.
  Match the surrounding comment density, naming, and idiom.
- **TypeScript is the source of truth.** Packages are `.ts` and stay `.ts`. A component must never
  exist as both `.ts` and `.js` — twins drift silently, in *both* directions.
- **Artifacts are never committed.** `dist/` is gitignored and produced only by `npm run build`. An
  example that needs a bundle points at `packages/<pkg>/dist/`; it never gets its own copy.
- **Don't silently refactor.** If a better pattern exists, or you hit a legacy/experimental area,
  complete the asked task and *flag* the improvement with why/where/how — the developer decides.

## 2. Web-standards-native best practices

Idiomatic platform code — nothing bespoke where the platform already has the right tool. The whole
premise of VeraJS is that the platform is now good enough; act like it.

- **Native web components first.** Custom Elements, Shadow DOM, `adoptedStyleSheets`, `<slot>`,
  `<template>`. Do not reimplement what the browser ships.
- **Respect lifecycle contracts.** `connectedCallback` can fire more than once; `disconnectedCallback`
  must actually clean up (listeners, effects, observers). An element may upgrade before or after it is
  parsed — never assume children exist.
- **Standard module semantics.** ESM only, explicit `.js` extensions in relative specifiers (required
  by `NodeNext`), bare specifiers for cross-package imports so every consumption mode resolves.
- **Memory discipline is part of correctness here.** The store leans on `WeakRef`/`WeakMap` to avoid
  retaining detached elements. Anything holding an element reference must not defeat that.
- **Do not leak the framework into the DOM.** The attribute conventions (`.prop`, `?bool`, `@event`,
  `route`, `view`, `autoloader`) are the public contract; keep them documented and stable.
- **Accessibility is not a follow-up:** keyboard path, focus management, and ARIA land in the *same*
  pass as any interaction. Never ship a mouse-only feature — including in examples, which people copy.

## 3. Simplest / least code, same functionality

The smallest correct change. Complexity must earn its place.

- **Minimal surface area** — add only what the task requires; a bug fix does not need surrounding
  cleanup. **Prefer editing an existing file over creating a new one** (but *do* create the right file
  when something needs a proper home — see #1).
- **Reuse before you build.** Extend what exists rather than rewriting it.
- **No back-compat shims for code you are removing**, and no speculative machinery for cases that do
  not exist yet — extensibility is designed-in cheaply (#6), not pre-built.
- **Experiments are labelled and contained.** Exploratory work lives in a clearly named directory
  (for example `src/experimental/`) with a note saying what it was trying and why it stopped. What it
  must never do is sit unlabelled next to production code — that is precisely how this repo ended up
  with three parallel SSR strategies indistinguishable from one another.
- Delete dead code the moment it is *actually* dead — but confirm it is dead first. In this repo,
  files that looked abandoned turned out to be the most advanced version (a 220-line component whose
  `.ts` "replacement" was a 43-line stub). **Audit before you archive; archive before you delete.**

## 4. Fast — performance is the other half of the thesis

Fast by construction, with cost paid where it is cheap and avoided where it is hot. **Small (#7) and
fast are a pair**; VeraJS only displaces React if it wins on both. Neither may be traded for the other.

> **Being native is a head start, not a guarantee.** Skipping a VDOM and shipping no framework runtime
> puts VeraJS ahead at the starting line, but the platform does not hand you speed for free, and three
> costs here are real: proxy traps run on *every property read* (cost scales with access count, not
> change count); custom element upgrade and repeated `connectedCallback` invocations are not free; and
> `packages/renderer` performs DOM diffing, which is the same class of work a VDOM does, merely
> against real nodes. **Performance claims must be measured, never inferred from "it's native."**

- **The render path is hot.** Do the least there. Reactivity should touch only what changed — the
  proxy/callback graph exists so a render is proportional to the diff, not to the tree.
- **Benchmark before and after anything on a hot path**, and state the numbers. "Should be faster" is
  not a result. Where a benchmark does not exist yet for the path being changed, say so rather than
  asserting an improvement.
- **Cheap guards over redundant work:** bail on unchanged values before doing any work, fast-path the
  common case, batch one write instead of N.
- **Effects are scheduled, not immediate** — `useLayoutEffect` → render → `useEffect` is a deliberate
  ordering. Do not force synchronous work into a phase that does not need it.
- **Build cost matters too.** wireit caching depends on each script's `files`/`output` globs being
  *accurate*; a wrong glob silently disables caching or breaks `clean`. Verify globs against what the
  build actually writes.
- Efficiency never comes at the cost of security (#8) or correctness — measure the trade, surface it.

## 5. DRY

One source of truth for every fact and every behavior.

- **Shared logic → one home:** `@verajs/shared-utils` and `@verajs/shared-types` exist for exactly
  this. A helper needed by two packages goes there rather than being copied.
- **One source of truth for data:** a package's `filename` field drives its rollup output, its `main`,
  its `types`, and every `exports` path. Derive these; never hand-maintain them in parallel.
- **DRY is about *knowledge*, not superficial text.** Do not fold two things that merely look alike
  but can legitimately diverge. The clearest example in this codebase is deliberate duplication:
  production bundles each inline their own copy of `@verajs/inserts` **on purpose** (see #6) — that is
  not a DRY violation to be "fixed".
- **Documentation is subject to DRY too.** A fact lives in one document. `CLAUDE.md` holds parameters,
  this file holds the bar, the rest of `docs/` holds findings; cross-reference rather than restate.

## 6. As extensible as possible

New capability should slot into the existing shape, not require reshaping it. **For VeraJS this is not
a nice-to-have — the module system is the product.**

- **The insert system is the extension point.** `insert(name, callback, priority)` is how renderers,
  autoloaders, proxy handlers, and third-party modules attach. A new capability should be a new insert,
  not a new branch in core.
- **Modules are independent by design.** `@verajs/router`, `@verajs/autoloader`, `@verajs/renderer`
  and the rest do not require `@verajs/core` at runtime. Anyone must be able to take one module, or
  write their own, without adopting the whole framework. **Do not introduce a dependency from a module
  back into core.**
- **Understand the consequence before you "fix" it:** because standalone bundles inline everything,
  loading `vera.min.js` *and* `vera-router.min.js` produces **two separate `inserts` Maps**. That is
  why `connectInserts()` exists. It is intentional, and it is the price of genuine module
  independence. Never resolve it by making bundles share global state.
- **Design for the likely next axis of change** cheaply — a config option beats a hard-coded constant
  when a second case is plausible (for instance the autoloader's hardcoded `.js` extension, which
  blocks the TypeScript consumption mode outright) — without building unused machinery (#3).
- Prefer additive, backward-compatible extension points over changes that ripple across modules.

## 7. Small — weight is the product

VeraJS exists to replace React and heavier libraries on most builds. **If it is not small, it has no
reason to exist.** Size is a feature, tracked like a test, and it is the first thing an outside
evaluator will measure. Small and **fast (#4)** are the paired thesis — neither is traded for the other.

- **Every byte in `dist/*.min.js` must justify itself.** Core carries what most people genuinely need;
  everything else is an opt-in module. When something can live in a module, it lives in a module.
- **No runtime dependencies in the browser packages.** A framework that pulls a dependency tree is not
  tiny. (SSR is Node-only and is exempt — it is never shipped to a browser.)
- **Know the number.** A change that moves bundle size should say so, with before/after. Growth is a
  trade to surface, not a silent cost.
- **Tree-shakeability is part of size.** Keep exports granular and side-effect-free so consumers can
  drop what they do not use. Watch for module-scope side effects that defeat this — `@verajs/router`
  registers `window` listeners at import time, which is a real constraint, not an accident.
- Prefer a platform primitive over a polyfill, and no code at all over clever code.

## 8. Extremely security focused

As secure and safe as possible — when in doubt, reject. **A rendering library is an XSS engine if you
get this wrong**; templates are the attack surface.

- **Escape at the render boundary**, not at the source. Interpolated values are data until something
  writes them to the DOM; the escaping belongs at the single place where that happens. Escaping early
  double-escapes and corrupts legitimate content.
- **Never route untrusted content through `innerHTML` unsanitized.** The SSR renderer runs values
  through DOMPurify for exactly this reason; the client path must hold the same line. Any new sink
  (`innerHTML`, `insertAdjacentHTML`, `document.write`, `template.innerHTML`) needs a documented
  justification.
- **Event and property bindings are code paths.** `@event` and `.prop` bindings assign real functions
  and values — they must only ever resolve from the template's own scope, never from a user-supplied
  string.
- **Preserve documented invariants** across every path that could break them, including SSR and
  hydration. A value that is safe on the server must not become unsafe when rehydrated — mismatches
  between server and client escaping are a classic injection vector.
- **Untrusted input is data, never code.** It must never reach `eval`, `new Function`, a dynamic
  `import()`, or a file write unchecked. The autoloader constructs module URLs from tag names —
  anything that turns attacker-influenced text into a module URL is a genuine risk and needs bounding.
- **SSR runs on a server.** Node-side code has filesystem and process access the browser does not.
  Path handling must resolve and confirm containment within an allowed base before use.

## 9. Buildless by default

**Everything must work with no build step at all.** Paste it into CodePen, open an HTML file from
disk, drop it into a `<script type="module">` — it works. A build is something you opt into for
minification, Tailwind, or TypeScript; it is never a prerequisite for using VeraJS.

This is the sharpest difference between VeraJS and React or Astro, both of which are unusable without
a toolchain. **It is a hard constraint on design, not an aspiration**, and it rules things out:

- **No JSX.** It cannot run in a browser without a compile step. Templates are tagged template
  literals, which are native.
- **No decorators**, no TypeScript-only runtime syntax (`enum`, parameter properties,
  `constructor(private x)`), and nothing else that requires transpilation to execute.
- **Ship browser-ready ESM.** `dist/*.min.js` must run directly from a `<script type="module">` with
  no bundler, no import rewriting, and no `process.env` or `require` anywhere in the output.
- **Bare specifiers need an importmap to work buildless** — so any documented CDN usage must show the
  importmap, and every module must remain resolvable that way.
- **A feature that only works after a build is not finished.** If TypeScript source is the only way to
  use something, the JavaScript path is missing.

**Tailwind must work too.** Buildless Tailwind means the CDN JIT build, and it collides with Shadow
DOM: Tailwind emits global stylesheet rules, and a shadow root blocks them by design. The escape
hatch already exists — `adoptStyles` from `@verajs/styles` (`adoptedStyleSheets`), or light-DOM
rendering via `init(element)` with no shadow options. Any component or example that uses Tailwind must pick one
explicitly and say which; "it works in the light DOM and silently does not in the shadow DOM" is a
trap for users.

---

## Applying these

- **Every non-trivial change should be checkable against this list.** For an audit, walk all nine per
  file/behavior and note where each is met, at risk, or violated.
- **Equal weight is the rule that makes the others honest:** you cannot justify insecure code by "it's
  simpler," or duplicated code by "it's faster." If you cannot satisfy all nine, that is a
  conversation with the developer, not a silent trade.
- **Surface, don't bury.** Trade-offs, legacy smells, and better patterns spotted in passing get
  raised with why/where/how — the developer decides whether to act now, defer, or accept.
- **Given this project's history, one extra rule:** when you find something that looks like a mistake,
  establish what it was *for* before judging it. Much of this tree is experimentation that was never
  labelled. Audit first, then recommend.
