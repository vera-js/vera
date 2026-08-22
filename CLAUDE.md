# CLAUDE.md — VeraJS

Operational conventions and project parameters. Records decisions that are **not** derivable from the
code, so they are not re-litigated.

- **The bar for any change:** `docs/CODE-PRINCIPLES.md` (nine principles, equally weighted)
- **Findings, audits, todos:** `internal/docs/` — the private portal (see *Repositories*)
- **AI-facing API spec:** `llms.txt` at the root (convention puts it there, like `robots.txt`).
  Hand-maintained, so it drifts — the generated `packages/*/dist/development/*.d.ts` is the source
  of truth. Update it in the same pass as any API change. It carries the complete **buildless JSX
  recipe** (import map + `@verajs/jsx/standalone`), which is the fastest path to a working
  single-file demo.
- **Writing templates:** prefer a stable shape with `?hidden=${…}` over swapping subtrees
  conditionally — template identity holds, so values update in place instead of the subtree being
  torn down and rebuilt. (This was also a correctness issue before 0.1.2; see
  `tests/renderer-sibling-parts.test.mjs`.)
- **Testing a component without a browser:** compile with `transformJsx`, run under jsdom with
  `pretendToBeVisual: true`, and await a frame (the scheduler is `requestAnimationFrame`). **Seed
  `Math.random`** if the component uses it — DOM-shape-dependent bugs are otherwise intermittent
  and bisecting them produces contradictory results.
- **Public-facing claims:** `docs/features/` — every claim there must stay measured and reproducible;
  if a change moves a number, update the feature doc in the same pass

---

## How we work together

**Commits carry no AI co-author trailers** (Brian's call, 2026-08-21): author is Brian alone.


**Brian is the source of truth for every decision.** This is the operating rule that outranks the
rest of this file.

- **Say what is going to happen before it happens.** Explain the plan, then wait. Do not begin a
  multi-step change, a restructure, a file move, or a new dependency and narrate it afterwards.
- **Get approval before acting.** Approval for one step is not approval for the next. Approval to
  investigate is not approval to change.
- **Recommend, and argue for it.** Brian explicitly wants to be persuaded and nudged toward the right
  choice — not handed a neutral menu. When asked "what do you recommend?", answer with a specific
  recommendation and the reasoning, including the strongest counter-argument. A passive list of
  options is a failure to do the job.
- **Push back when the evidence supports it.** If a request rests on a wrong premise, say so plainly
  with the evidence, give the recommendation, and then follow the decision once it is made.
- **Narrate discoveries as they happen**, especially anything that changes the plan. A finding that
  invalidates the current approach gets surfaced immediately, not at the end.
- **Never assume abandoned code is dead.** See `docs/CODE-PRINCIPLES.md` #3. Audit, report what it was
  for, and let Brian decide.
- Collaboration is the point. Prefer a short check-in over an impressive unilateral result.

---

## What this is

A tiny, web-components-based modular library intended to **replace React and heavier libraries on most
builds**.

The shape of the product:

- **`@verajs/core`** covers most of what people actually need.
- **A module system** lets people use the prebuilt modules — `autoloader`, `jsx`, `renderer`,
  `router`, `ssr`, `styles` — or write their own. (`map-support` was retired: reactive `Map`/`Set`
  moved into core. `styles` went the other way in 0.2.0 — `static styles` adoption left core,
  recovering 300 B gzipped for every app that does not use it.)
- At minimum you need **a renderer**. Everything else is opt-in.

**History.** Built solo, by hand, before AI agents existed. The tooling came out of one person's head
rather than from established practice, and is acknowledged as not the best. Much of the tree is
experimentation that was never labelled as such.

**Goals.**

1. A deliberate overhaul of the project's structure and tooling — in progress.
2. Then a genuine **viability audit**: is this still worth building, and does it add value in today's
   landscape? That evaluation is meant to be honest, not confirmatory.

---

## Consumption modes — all first-class

Every one of these must keep working. A change that breaks any of them is a regression.

**Buildless is the baseline, not a fallback.** VeraJS must work with no toolchain — paste into
CodePen and it runs. A build is opt-in for minification, Tailwind, or TypeScript. This rules out JSX,
decorators, and any TypeScript-only runtime syntax outright. See `docs/CODE-PRINCIPLES.md` #9.

| Mode | How it resolves | Exercised by |
| --- | --- | --- |
| **npm + TypeScript** | `exports.development` in dev, `exports.default` in prod, `exports.types` for `.d.ts` | `examples/npm-ts/` |
| **npm + plain JS** | same bare specifiers, no type layer | `examples/npm-ts/` |
| **CDN / `<script>`** | linked `dist/*.min.js`, no build step, no bundler | `examples/cdn-js/` |
| **SSR** | Node-only, `@verajs/ssr` | `examples/ssr-node/` |

> **SSR does not meet this bar yet.** The wcc fork needs `@projectevergreen/escodegen-esm`,
> `acorn-import-attributes` and a vendored `jsx-loader.js`; the Astro path needs `linkedom`. None are
> installed. First-class *target*, known gaps. See `packages/ssr/README.md`.

## Modules are independent — by design

`@verajs/router`, `@verajs/autoloader`, `@verajs/renderer` and the rest **do not require
`@verajs/core` at runtime**. The consequence is load-bearing and non-obvious:

- Production `.min.js` bundles **inline everything**, including `@verajs/inserts`. Loading
  `vera.min.js` *and* `vera-router.min.js` therefore yields **two separate `inserts` Maps**.
- That is exactly why **`connectInserts(inserts)`** exists, and why the CDN entry point must call it.
  This is not a bug. Do not "fix" it by making bundles share state.
- **Corrected 2026-08-22.** This previously said the npm/bundler path resolves to one
  `@verajs/inserts` instance, making `connectInserts` a harmless no-op. **That is true only under
  the `development` condition.** A production bundler build resolves `exports.default` —
  `dist/*.min.js` — which inlines the registry, so core and router each get their own. Measured:
  bundling `@verajs/core` + a second package yields **1** registry with `--conditions development`
  and **2** without. `examples/npm-ts` calling `connectInserts` is therefore necessary, not
  ceremonial.
- **Rule for anything that registers an insert: take `insert` from `@verajs/core`, never from
  `@verajs/inserts`.** Core's own function writes to the map core reads, in every build. Registering
  through your own copy works in development and silently does nothing in production — it does not
  throw, the callback simply lands where core never looks. `@verajs/styles` was written the wrong
  way first and passed every development test. `tests/cdn-cross-bundle.test.mjs` guards this now.
- `@verajs/ssr` self-wires correctly by taking `setRenderer` and `insert` from core. (Core used to
  self-register a default renderer at module scope, which was safe only because it lived *inside*
  core's bundle with no boundary to cross; it was removed in 0.2.0.)

`dist/development/*.js` keeps workspace deps **external** (the consumer's bundler dedupes them);
`dist/*.min.js` inlines them (standalone). Both outputs are intentional.

## Source of truth rules

- **TypeScript is the source.** `packages/*/src` is `.ts` and stays `.ts`.
- **A component never exists as both `.ts` and `.js`.** Twins drift silently in both directions. When
  a richer `.js` version exists it is **ported forward into `.ts`** — never the reverse.
  (`goodbye-component.js` was 220 lines against a 43-line `.ts` stub; assuming the `.ts` was newer
  would have destroyed the most valuable test component in the repo.)
- The plain-JS consumption story is served by **built** `dist/*.min.js`, never by hand-maintained
  `.js` sources.
- **`dist/` is gitignored. Never commit a bundle.** Committed copies went stale and silently tested
  pre-refactor code for an unknown period.
- Package `exports` must resolve to files the build actually writes: dev →
  `dist/development/<filename>.js`, prod → `dist/<filename>.min.js`.

## Repositories

**`vera-js/vera` (public) is the project.** Code, issues, PRs, CI and releases all live here, and
releases publish to npm from here — npm provenance requires a public source repo, so publishing
from anywhere else forfeits the attestation. There is no mirror and no sync step.

**`vera-js/internal` (private) is a portal**, cloned into this tree at `/internal` and gitignored.
It holds what genuinely cannot be public:

| `internal/docs/VIABILITY.md` | verdict, kill criteria, headwinds |
| --- | --- |
| `internal/docs/TODO.md` | pending work, unfixed defects, open questions |
| `internal/docs/PUBLISHING.md` | operator runbook — npm account, 2FA, release mechanics |
| `internal/docs/audits/` | per-package audits |
| `internal/archive/` | superseded work, kept for reference. Nothing imports it. |

**Audits and TODO are private on purpose.** Both are pre-fix documents. A public audit during the
window between finding a defect and shipping its fix publishes an unpatched bug. Security issues go
through GitHub private security advisories (`SECURITY.md`), never a public issue — and the *patch
commit* is itself a disclosure, so the fix is developed in the advisory's private fork and released
before the advisory is published.

Set up on a new machine:

```sh
git clone https://github.com/vera-js/vera.git && cd vera
git clone https://github.com/vera-js/internal.git internal   # gitignored here
```

**`vera-js/vera-private` is archived** — the frozen full history of the work before the public repo
became primary. Read-only, never cloned into this tree, never pushed to again.

## Layout

```
packages/          published framework modules; each independent
  ssr/             Node-only, plain ESM, NOT run through defaultRollupConfig
examples/          hand-run playgrounds, one per consumption mode
tests/             self-running; never requires a human to look at a page
bench/             performance harness; `--compare` gives before/after numbers
                   NOT a workspace member — it has its own package.json holding the ten
                   competing frameworks, so a root `npm ci` installs none of them.
                   `cd bench && npm install` before running any comparative benchmark.
docs/              principles, architecture, feature claims  (public)
internal/          private portal — strategy, todos, audits, archive. Gitignored here.
```

**examples vs tests:** examples are for experimenting by hand. Tests run themselves. Neither
substitutes for the other.

**The repo root is for configuration only** — no source, no bundles, no experiments. `CLAUDE.md` sits
at the root because Claude Code auto-discovers it there; that is a technical requirement, not a
precedent for other documents.

**All project docs are git-versioned on purpose**, so they travel to other installs and to any future
collaborator — the public ones in this repo, the private ones in `vera-js/internal`.
`.claude/settings.local.json` stays gitignored — it is machine-specific.

## Testing

Two layers. **Fast layer (installed):** `node --test` + jsdom in `tests/*.test.mjs` — ~170 checks
against built artifacts, CI-ready. **Every suite runs twice**, against `dist/development/*.js` and
against `dist/*.min.js` — `npm test`, `npm run test:prod`, or `npm run test:all`. They are different
programs: production mangles properties, folds `__DEV__` to `false` and deletes the branches, drops
`console.log`, and inlines workspace dependencies. `tests/dist.mjs` resolves the artifact; a suite
never hard-codes a path. `tests/cdn-cross-bundle.test.mjs` covers the two-registry `connectInserts`
condition, which **only exists in the production build** — verified to fail if `_p` is ever mangled. **Browser-truth layer (chosen, not yet
installed):** `@web/test-runner`, in a real browser — shadow DOM, custom element upgrade timing and
`adoptedStyleSheets` are emulated under a fake DOM, and for this framework a pass under emulation
is weak evidence. The jsdom suites are the regression net; browser suites are the release gate.
Every consumption mode gets a suite asserting the same API surface.

## Versioning

**Independent per package** — `@verajs/autoloader` has no reason to bump because `@verajs/core` did.
Changesets is set up (`.changeset/`). Full process in **`docs/RELEASING.md`** — read it before
touching versions, `.changeset/`, or `release.yml`.

**While we are `0.x`, MINOR is the breaking boundary, not major** — `^0.1.2` installs `0.1.3` but
never `0.2.0`, so that is where npm already draws the line. Features and fixes are both **patch**;
minor is reserved for breaking changes. Changesets defaults to 1.0+ semantics, so a feature has to
be marked `patch` deliberately. Ordinary semver resumes at `1.0.0`. The loop:

```sh
npx changeset version && node scripts/tag-release.mjs && git push --follow-tags
```

CI publishes whatever master has that npm does not, authenticated by npm **Trusted Publishing**
(OIDC). Three invariants that silently break publishing if violated:

- **`release.yml` must keep its name** — the trust binding on all seven packages names
  `vera-js/vera` + `release.yml`.
- **`repository.url` must stay `git+https://github.com/vera-js/vera.git`** — the registry compares
  it against provenance and rejects a mismatch with 422.
- **Never add an `NPM_TOKEN`.** No secret exists in the release path; failures are fixed in the
  trust configuration, not with a credential.

There is deliberately no Version PR (reasoning: `internal/docs/RELEASE-DESIGN.md`).
`shared-types`/`shared-utils` are private — inlined everywhere, never published.

## Known gaps

- **SSR dependencies** — see the callout above.
- **A separate wcc experiment exists** in Brian's GitHub account: a personal take on wc-compiler using
  disconnected acorn and possibly regex-based shape identification. It carried a lot of unwanted extra
  material, so whether it is the way forward is **an open discussion requiring experiments**, not a
  settled decision.
- **Browser test layer (`@web/test-runner`) still to install** — node+jsdom suite, CI, and release tooling exist.
