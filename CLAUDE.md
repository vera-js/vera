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
- **jsdom is stricter than a browser about `setAttribute`, and that difference has already produced
  one false finding.** jsdom implements the XML Name production and throws on `a(b)`, `a|b`, `a?b`
  and about fifty other shapes; **every real engine accepts them**, rejecting exactly `a b`, `a>b`,
  `a=b` and `a/b`. `tests/browser/spread-names.test.js` records the engines' rule on purpose — read
  it before changing anything about attribute-name validation, because a jsdom probe will tell you
  the denylist is broken when it is exactly right. More generally: **jsdom is the regression net,
  never the oracle** for anything the platform decides.
- **Re-measure the baseline between size runs, and never trust a single one.** `npm run build` is
  cached, so a probe that patches a source and forgets to rebuild reports the *previous* variant's
  number — this produced a confident "`hold` is worth 368 B" when the real figure is 16 B, because
  the measurement had silently reused the previous experiment's bundle. Print the baseline after
  restoring, every time. The same applies to timings: `bench/reactivity.mjs` read 163 ns/op straight
  after the browser suite and 132 on a quiet machine, so take three runs before believing a
  regression.
- **An ad-hoc probe must run with `--conditions development`.** `npm test` passes it; a bare
  `node probe.mjs` does not. Without it, a package that keeps `@verajs/core` external —
  `@verajs/reactivity`, `@verajs/reactivity/collections`, anything built on core's public API — resolves core
  through `exports.default`, which is `dist/*.min.js`. The probe then holds **two cores**: writes go
  to one store registry and subscriptions live in the other, so reactivity looks completely dead and
  every `__DEV__` guard looks missing. This has produced false "computed is inert" and "the guard
  never fires" findings on separate occasions.
- **Two template literals are two templates, even with identical text.** Template identity is the
  `strings` array, which the engine interns per *call site* — so writing the same markup twice in a
  probe produces a rebuild, not an update, and every conclusion drawn about update behaviour is
  then wrong in the same direction. Render through **one** `draw()` function called twice. This has
  produced confident false findings about `keyed`, `hold` and `!live` on separate occasions; when a
  result says the DOM was rebuilt or a value was lost, suspect the probe before the renderer.
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
- **Every `console.warn`/`console.error` the framework prints starts `[vera]`**, so a user can find
  all of them with one filter. A thrown `Error` may name its function instead — a stack already names
  the source — but a message the framework also prints carries the prefix.
  `tests/diagnostics-convention.test.mjs` asserts it across every source file rather than trusting it.
- **Removing an API means adding its name to `tests/docs-removed-apis.test.mjs`.** One line, at the
  moment the knowledge exists. That list is what turns "we remembered to grep the docs" into
  something the gate refuses to let through — `setRenderer` survived its own deletion in 23 places
  across `llms.txt`, four READMEs and `docs/ARCHITECTURE.md`, with every suite green. Prose is where
  API names live, and it is the half no recipe or import check can reach.
- **"Worth documenting" means document it, now.** If a finding is worth a sentence in conversation,
  it is worth the same sentence in the file where someone will hit it — the README, the doc comment,
  `llms.txt`, `internal/docs/`. Saying it and not writing it down produces exactly the drift these
  docs exist to prevent, and the moment it is understood is the only moment it is cheap. The same
  goes for "worth checking" and "worth flagging": do it in the same pass or say plainly that it is
  outstanding.
- Collaboration is the point. Prefer a short check-in over an impressive unilateral result.

---

## What this is

A tiny, web-components-based modular library intended to **replace React and heavier libraries on most
builds**.

The shape of the product:

- **`@verajs/core`** covers most of what people actually need.
- **A module system** lets people use the prebuilt modules — `autoloader`, `jsx`, `renderer`,
  `router`, `ssr`, `styles` — or write their own. (`map-support` was retired into core and then
  moved back out as `collections` in 0.2.0, on a **type-keyed** `'collection'` insert point rather
  than the `'proxy-handler'` chain that made the first attempt costly — 292 B recovered for every
  app without a `Map` in a store, 24 B added for those with one. `styles` went the same way in
  0.2.0 — `static styles` adoption left core, recovering 300 B gzipped for every app that does not
  use it.)
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

> **SSR is vera-native and has no dependencies** — no wcc, no lit, no acorn, no parse5. The earlier
> wcc-fork and Astro strategies, which needed `@projectevergreen/escodegen-esm`,
> `acorn-import-attributes`, a vendored `jsx-loader.js` and `linkedom`, are gone; nothing installs
> them and nothing needs them. `tests/ssr-native.test.mjs` covers declarative shadow DOM, nesting,
> escaping, sigil stripping, `static styles` and determinism, and the server→client handoff is
> exercised for real: `scripts/build-hydration-fixture.mjs` renders through the actual pipeline and
> the browser suite hydrates that output, with `--check` in CI so the snapshot cannot drift.

## Modules are independent — by design

`@verajs/router`, `@verajs/autoloader`, `@verajs/renderer` and the rest **do not require
`@verajs/core` at runtime**. The consequence is load-bearing and non-obvious:

- Production `.min.js` bundles **inline everything**, including `@verajs/inserts`. Loading
  `vera.min.js` *and* `vera-router.min.js` therefore yields **two separate `inserts` Maps**.
- That is why **no module carries a registry of its own**. The router is handed core's — `wire([renderer,
  router])` — and every other module registers through core's `wire`. This is not a bug to "fix" by
  making bundles share state; it is why the hazard is removed by construction instead.
- The reconciliation step that preceded this was removed in 0.2.0: it was load-bearing on a CDN page
  and ceremonial under a bundler, so the failure it guarded appeared in production only. Worth
  keeping the measurement it rested on: bundling `@verajs/core` + a second package yields **1**
  registry with `--conditions development` and **2** without.
- **Rule for anything that registers an insert: take `wire` from `@verajs/core`, never from
  `@verajs/inserts`.** Core's own function writes to the map core reads, in every build. Registering
  through your own copy works in development and silently does nothing in production — it does not
  throw, the callback simply lands where core never looks. `@verajs/styles` was written the wrong
  way first and passed every development test. `tests/cdn-cross-bundle.test.mjs` guards this now.
- `@verajs/ssr` self-wires correctly by taking `wire` from core. (Core used to
  self-register a default renderer at module scope, which was safe only because it lived *inside*
  core's bundle with no boundary to cross; it was removed in 0.2.0.)

`dist/development/*.js` keeps workspace deps **external** (the consumer's bundler dedupes them);
`dist/*.min.js` inlines them (standalone). Both outputs are intentional.

## Source of truth rules

- **TypeScript is the source.** `packages/*/src` is `.ts` and stays `.ts`. **`packages/ssr` is the
  one exemption** (agreed 2026-08-24): it publishes its `src` directly, with no build and no `dist`,
  so `.ts` there would either need the build step the package deliberately does not have or ship
  `.ts` to consumers. It is still type-checked — `checkJs` plus JSDoc types and explicit casts, in
  `npm run gate` alongside every other package — so the intent of the rule is met without the
  toolchain. Nothing else gets this exemption.
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

Two layers, both installed and both in CI.

**Fast layer:** `node --test` + jsdom in `tests/*.test.mjs` — 143 checks against built artifacts.
**Every suite runs twice**, against `dist/development/*.js` and against `dist/*.min.js` —
`npm test`, `npm run test:prod`, or `npm run test:all`. They are different programs: production
mangles properties, folds `__DEV__` to `false` and deletes the branches, drops `console.log`, and
inlines workspace dependencies (9 checks are development-only and skip accordingly).
`tests/dist.mjs` resolves the artifact; a suite never hard-codes a path.
`tests/cdn-cross-bundle.test.mjs` covers the two-registry condition, which **only exists in the
production build** — verified to fail if `_p` is ever mangled.

**Browser-truth layer:** `@web/test-runner` + Playwright, `tests/browser/*.test.js` — 29 checks on
**Chromium, Firefox and WebKit** (`npm run test:browser`, `npm run test:browser:all`, or
`VERA_BROWSERS=webkit npm run test:browser`; the `--browsers` CLI flag is unusable because the
config defines its own launchers). Shadow DOM, custom element upgrade timing, `adoptedStyleSheets`
and `@scope` are emulated or absent under a fake DOM, so for this framework a pass under emulation
is weak evidence — and so is a pass on one engine. The jsdom suites are the regression net; browser
suites are the release gate.

**Documented code is executed, not just written.** `tests/docs-recipes.test.mjs` runs the root
README's quick-starts and every block marked `<!-- recipe -->` in any README, each in its own
process. Isolation is per-process rather than per-import because under the `development` condition
workspace deps stay external, so every copy of core shares one `@verajs/inserts` — a recipe that
never wired a renderer otherwise passes on one an earlier recipe registered.

## Versioning

**Independent per package** — `@verajs/autoloader` has no reason to bump because `@verajs/core` did.
Changesets is set up (`.changeset/`). Full process in **`docs/RELEASING.md`** — read it before
touching versions, `.changeset/`, or `release.yml`.

**While we are `0.x`, MINOR is the breaking boundary, not major** — `^0.1.2` installs `0.1.3` but
never `0.2.0`, so that is where npm already draws the line. Features and fixes are both **patch**;
minor is reserved for breaking changes. Changesets defaults to 1.0+ semantics, so a feature has to
be marked `patch` deliberately. Ordinary semver resumes at `1.0.0`. The loop:

```sh
npx changeset version
git add -A && git commit -m "release: …"    # changeset version only edits the working tree
node scripts/tag-release.mjs                # tags HEAD — so it must run AFTER the commit
git push --follow-tags
```

Both ordering rules are load-bearing and both were wrong here at some point. Skipping the commit
publishes nothing while CI reports success; tagging before it points every tag at the pre-bump
commit. Full walkthrough in `docs/RELEASING.md`.

CI publishes whatever master has that npm does not, authenticated by npm **Trusted Publishing**
(OIDC). Three invariants that silently break publishing if violated:

- **`release.yml` must keep its name** — the trust binding on every published package names
  `vera-js/vera` + `release.yml`. Counting them here only invites drift; `npm trust list` is
  authoritative.
- **A brand-new package cannot use Trusted Publishing for its first publish.** npm requires the
  package to exist before a trusted publisher can be configured, by UI or by `npm trust github`, so
  the first version goes up manually and CI takes over from the second. Runbook:
  `internal/docs/PUBLISHING.md`.
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

