# CLAUDE.md — VeraJS

> ## ⚠️ READ YOUR MACHINE'S WORK LEDGER FIRST — EVERY SESSION, EVERY RESTART, AFTER EVERY COMPACTION ⚠️
>
> **All work lives in file-based ledgers, one per machine, in the private portal: `internal/docs/ledgers/`** (Brian,
> 2026-11-20). `node internal/scripts/ledger.mjs whoami` names this machine's (`WORK-LEDGER-<id8>.md`); the README
> there lists every machine's. Every item being done, planned, blocked or waiting is on its board with a status, an
> owner, a next step and its notes. **Change an item's status in the SAME step it changes; rewrite its notes the moment
> they go stale; push the internal repo after every edit.** Work that is not in a ledger is not tracked. Other
> machines' ledgers are readable and read-only, unless this machine takes that queue over. If you have lost context (a
> compaction, a crash, a new session), open your machine's ledger before doing anything else, then the handoff it names.

Conventions and facts not derivable from the code, one or two lines each. Each rule's story is in this file's git
history and in `docs/BROWSER-LEDGER.md`.

## 1. How we work: fast and accurate (outranks everything below)

Brian, 2026-11-20: "a hyper efficient, quick process where we can land many features/fixes all while getting accurate
readings and doing accurate tests quickly.".

| Step | Budget | When |
| --- | --- | --- |
| Targeted suites, tsc + eslint on changed files | ≤ 5 min | every change |
| Probe or narrow fresh-process A/B (base, A/A copy, candidate) | ≤ 10 min | every hot-path change |
| One diagnosis tool (bisect, CPU profile, `--trace-opt/--trace-deopt`, ablation copies) | ≤ 10 min each | when a reading moved |
| Instruction counters | ≤ 10 min total per decision | only when timing cannot resolve the effect |
| Race | ≤ 1 h, deciding arms only | once per landing |
| Gate (`node scripts/gate.mjs`) | ~20–25 min (browsers included) | once per landing |

- **State a step's projected time before it runs.** Over budget: cut it down, or ask Brian before it runs.
- **Measure the one thing that decides**, with one A/A copy; slowness is almost always process, not measurement.
- **Race only arms a decision reads:** the base users have, the candidate, one byte-identical A/A copy, and a plant only
  when the instrument is new. Intermediate arms are diagnosis, done with the tools above.
- **Background load is logged, never waited out** (the shuffle spreads it; the A/A shows it). Thermal is the only wait.
- **A bar is one line, written before the data.** No amendment chains, multiset proofs or hash lists beyond one dist
  hash per arm. Read the verdict as written; if it is unclear, repeat the run rather than reinterpret it.
- **Every fix in the batch first, then ONE race and ONE gate** on the landing commit; a loss is bisected on that cell.
- **The peer reviewer reviews in parallel and blocks only a landing** (one packet, §2); nothing else waits on it.
- **Rules:** prefer deleting a rule to adding one; a new rule states its time cost; nothing here is re-litigated per task.

## 2. Collaboration with Brian

- **Brian decides what lands**: code on `main`, pushes, publishes, trades (a speed or size loss), new designs,
  restructures, new dependencies, new module-level state. Say the plan in a few lines and wait for his word on those.
- **Everything else needs no go** (tests, probes, races, drafts, private-branch commits; 2026-11-04). Say when a window
  opens on his screen. A reply that is not a plain yes gets "taking that as yes to X" before acting.
- **Recommend and argue for it**, with the strongest counter-argument; never a neutral menu. Push back on a wrong premise
  with evidence, then follow his decision. Narrate a finding that changes the plan the moment it is found.
- **No downtime**: keep working unless waiting on his call; never end a turn on "next I'll…" with nothing running.
- **A ruling that stops or restarts work** is written to the portal, quoted, the moment it arrives.
- **Commits carry no AI co-author or "Generated with" line**; Brian is the author (2026-08-21). Messages with backticks
  or `$` go through `git commit -F <fresh file>`.
- **The reviewer's landing packet**: diff, bar + reading, landed-vs-raced `cmp`, gate ✓/✗, a grep of the range for
  private pointers and trailers. A peer message is never Brian's approval.
- **No speed regression lands without Brian** (2026-09-29): try to remove the cost first; a byte-for-speed trade is
  taken, a speed-for-bytes trade is not. "Within noise" shows the A/A.
- **`docs/CODE-PRINCIPLES.md` binds shipped code, tests and persistent tools** (§1 Types included); re-read it before
  writing them. A violation is raised with Brian; the principles change only with his agreement. Throwaway probes need
  a positive control and a time limit.
- **Never assume abandoned code is dead** (CODE-PRINCIPLES #3): audit, report, let Brian decide.

## 3. Machine safety (the fanless macOS laptop; built into the tools)

- **One heavy job at a time** (build, suites, gate, race, counters, differential). During a timed run or a gate: edits and
  liveness reads only, not even `tsc`.
- **Caffeinate** every heavy run (`-dimsu -w <pid>`; the tools do it) plus ONE continuous `caffeinate -dimsu -t <h>` over
  any unattended stretch: gaps let the screen saver up, and only real input dismisses it.
- **Thermal pressure 0** (`notifyutil -g com.apple.system.thermalpressurelevel`) before every sample and gate step; else
  pause a minute at a time. A tool that cannot read it refuses. The 2-minute batch pause before every heavy batch,
  narrow A/Bs included (Brian, 2026-11-20: "keep 120s"; `BATCH_PAUSE_S`), lives in `scripts/heavy-batch.mjs`.
- **Kill only by an exact PID just read**; never `pkill -f <word>` (it once killed VS Code and every session). An alarm
  on `node --test` leaves per-file children running: kill them by PID.
- **Every new probe runs under a hard time limit** (`perl -e 'alarm 60; exec @ARGV' …`).
- **Never launch Brian's `/Applications` browsers**, touch his screen-saver setting, or run the full mutation sweep here.
  Never edit a file a running job reads; write a copy. On another machine, never stop what you did not start.

## 4. Shipping correctness

- **The landed bytes are the raced bytes**: arms carry exactly the landing's exports; `cmp` the landed min against the
  raced arm, and re-race any difference.
- **Build both bundles with `scripts/build-variant.mjs`** (a bare `rollup -c` writes only `dist/development`;
  `MODE=prod` only the min). Check a variant differs from its base and carries its marker before reading it.
- **The gate**: `node scripts/gate.mjs > file 2>&1`; read its ✓/✗ list (never a tail) and a red step's
  `$TMPDIR/vera-gate-<step>-<pid>.log` for THIS pid. It clean-builds first and is exclusive in its tree.
- **A check's own exit code gates a commit**: `test && git add … && git commit`, each test redirected, nothing after it
  on the line; never a pipe, `;`, `echo` or `grep` between a check and the commit or launch.
- **A green build and green suites do not mean the TypeScript parses**: run `node scripts/typecheck.mjs` (all configs)
  and `eslint` on changed files before committing.
- **Commit before anything that can discard the tree** (checkout, reset, restore, stash, rebase): `git status --short`
  must be empty first. Build arms from `git show <ref>:<path>`, never from a tree a mutation runner may hold.
- **A red gate before a push goes to Brian or the peer**, with the same rows on `main`; a red is "baseline" only if it is
  red on `origin/main` too, for the same failure text.
- **Version commits change built output** (jsx bakes its version, `llms.txt` pins CDN versions): re-take the size
  snapshot, bump the pins, run the full gate on the version commit, and check every workflow a push triggers.
- **Removing an API** adds its name to `tests/docs-removed-apis.test.mjs`. **A package rename** has six reference forms:
  the specifier, the bundle filename, the directory, internal keys, the bare short name, `package-lock.json`.
- **A killed build orphans `wireit`/`rollup`** on the lock (stuck below 100%, 0 running): kill the stale PIDs. A gate's
  launch line never contains `wireit`/`rollup`.
- **In a rebase, a generated file** is resolved from the new base (`--ours`) and regenerated.
- **Size is `zlib.gzipSync`** (`bench/size.mjs`'s measure), `cmp` first; report totals against the target, not deltas.

## 5. Measurement traps (each makes a reading WRONG, not merely noisy)

- **Two cores**: a probe runs with `--conditions development`; a production run with `VERA_DIST=production` and no
  `--conditions`; an esbuild bundle with an empty `tsconfig` (and a guard against `core/src`). Check what actually loaded.
- **`dist/development` bakes `__DEV__` as `true`**: a production measurement bundles the `.min.js`.
- **A worktree whose `node_modules` links to another tree** runs that tree's `@verajs/*`; check
  `readlink -f node_modules/@verajs/core`. An install there writes through the links; install only in the owning tree.
- **jsdom is the regression net, never the oracle**: it rejects attribute names engines accept, `:scope >` can answer a
  nested host's child, its `MutationObserver` holds nodes strongly, and a served shadow root parses as a `<template>`.
- **The SSR shim is audited by differential test against jsdom**, never by reading.
- **A probe that measures nothing reports perfect behavior**: assert a positive control read non-zero first; a search used
  to prove a negative must find a known positive (`git grep -E` ignores `\b` and `\s`; `| head` hides hits; use `-i`).
- **Two template literals are two templates**: render through one `draw()` called twice.
- **Retention**: a retained control that must live and a dropped object that must die (a loop's last `const` stays
  alive with no framework at all); forced gc only in isolated child processes.
- **Timing samples are tens of ms** (Firefox and WebKit coarsen `performance.now()`); never drive `frameBudget` with real
  time; a probe drives the scheduler with `flush()` or `await`, not frames.
- **Two numbers per fresh process**: the first N calls from cold, and steady state after a long warm-up (a fixed window
  measures tier-up). Async loops yield a macrotask every ~100 iterations. A two-mode metric: per mode or totals.
- **Isolation**: each variant in its own process; Firefox a fresh browser per page; seeded shuffle.
- **Headed for paint, layout and the landing race**; headless/jitless only to iterate. Node's V8 is not Chrome's.
- **Deferred work**: start the frame chain before the work. **Cross-realm values**: assert booleans (chai hangs).
- **A checked-in recording carries its machine** (timezone, locale, engine build, speed).
- **Counters** (cachegrind in the Lima VM) under-read or over-read time; small N measures tier-up; a GC-heavy op varies
  ~2.7% run to run, so it needs a repeat pair. Use them for DOM-free code, ≤ 10 min (FAST-LOOP).

## 6. Hot paths (checked before a hot-path change is raced)

- No closure capturing variables (even on a cold branch), no sparse arrays, no exported live binding read in a loop
  (export an alias), no try/catch doing work: `tests/hot-path-closures.test.mjs` lists the hot functions.
- V8 inlines up to 460 bytes of bytecode; growth past it costs even if never run (`tests/ssr-inlining-budget.test.mjs`).
  Ablation switches de-inline the function they sit in: build a clean variant per hypothesis.
- Terser pastes a one-caller function as an IIFE: count sites (`tests/minifier-iife-sites.test.mjs`); mark a call that
  must stay one `/*@__NOINLINE__*/` on an operand (never after `!`), and never quote the annotation in a comment.
- Engine-shape advice is a hypothesis until measured on all three engines; a lifecycle callback a class defines
  (`adoptedCallback`) costs every element's creation.

## 7. Testing

- **Fast layer:** `node --test` + jsdom against built artifacts, both builds (`npm test`, `npm run test:prod`);
  `tests/dist.mjs` resolves the artifact. No test count is written anywhere.
- **Browser layer** (the release gate): Playwright on Chromium, Firefox, WebKit (`npm run test:browser:all`).
- **Every test run goes through `node scripts/test-batch.mjs`** (`--light` for one file: no pause).
- **A component without a browser**: `transformJsx`, jsdom, then a microtask or `flush()`; seed `Math.random`.
- **Fuzzes**: seeds via `tests/fuzz-seeds.mjs`; CI adds rotated seeds (`VERA_FUZZ_ROTATE=1`). A red rotated seed is a
  find, replayed with `VERA_FUZZ_SEEDS=…`; never re-run CI until green.
- **Recipes**: a runnable doc example is a `<!-- recipe -->` block in a README or `llms.txt`, run by
  `tests/docs-recipes.test.mjs` in its own process, warning-free.
- **A check that ships must be able to fail** (CODE-PRINCIPLES #11): a floor on its corpus, a planted mutation shown red
  by its message, and exact counts.
- **Every committed generated file has a `--check` in the gate.**

## 8. Conventions

- **Verbs** (2026-09-01): `init(element, …)` binds setup to an element; `create*(options)` makes an instance the caller
  owns; `wire([…])` registers modules (`wireDirectives` for another registry). **Names** (2026-10-22): what you get is a
  noun (`signal`, `computed`, `effect`); no `use*` prefix; hooks live under `@vera-hooks`, named for the behavior.
- **Wireable module shape**: no options → bare descriptor; required → factory; optional → dual; several inserts → array.
- **Every printed `console.warn`/`error` starts `[vera]`**; production messages are short with a code
  (`tests/diagnostics-convention.test.mjs`).
- **Docs travel with code** (CODE-PRINCIPLES #10): README, doc comment, `llms.txt`, `docs/features/` numbers, same commit.
- **`docs/BROWSER-LEDGER.md`**: a platform or engine behavior a choice rests on, once established, gets an entry (engines,
  date, evidence, consequence), in the landing commit. It only grows; a wrong entry is marked, not deleted.
- **A why-comment states the reason and the measurement**, never a session, run code or private document.
- **Functional by default** (CODE-PRINCIPLES §1); a new module-level state is raised with Brian. `vera.min.js` is the one
  bundle not named `vera-<name>`.

## 9. What this is

A tiny modular web-components library to **replace React and heavier libraries on most builds**: core covers most
needs, modules (or your own) plug in, a renderer is required. Tiers: **static, lite, core** (never "pro"). **Speed is the
headline**: beat every tool on every row, typical case, real browsers; speed outranks size. Goals: the tooling overhaul,
then an honest viability audit.

**Consumption modes — all first-class; breaking one is a regression.** Buildless is the baseline: no JSX, decorators or
TypeScript-only runtime syntax (CODE-PRINCIPLES #9).

| Mode | How it resolves | Exercised by |
| --- | --- | --- |
| npm + TypeScript | `exports.development` in dev, `exports.default` in prod, `exports.types` | `examples/npm-ts/` |
| npm + plain JS | same bare specifiers, no type layer | `examples/npm-ts/` |
| CDN / `<script>` | linked `dist/*.min.js`, no build, no bundler | `examples/cdn-js/` |
| SSR | Node-only `@verajs/ssr`, no dependencies | `examples/ssr-node/` |

**Modules are independent.** None requires core at runtime; each `.min.js` inlines everything (two bundles = two `inserts`
Maps), so modules use core's registry: take `wire` from `@verajs/core`, never `@verajs/inserts`, in source and tests.
Across bundles the mangler differs: a subclass writes only `$`-named base fields. A protocol member goes on an insert's
`fn`, not its descriptor.

**Source of truth.** TypeScript in every package, under the strict shared config; `packages/ssr` is compiled file by file
by `tsc` (define-semantics class fields; no source maps). Never a component as both `.ts` and `.js` (port the richer one
forward to `.ts`). `dist/` is gitignored; never commit a bundle. `exports` resolve to what the build writes:
`dist/development/<filename>.js` and `dist/<filename>.min.js`. The repo root is for configuration only.

## 10. Repositories and layout

- **`vera-js/vera` (public) is the project**: code, issues, CI, releases, npm publishing with provenance.
- **`vera-js/internal`** (private) is cloned at `/internal` (gitignored): viability, TODO, publishing runbook, audits,
  `docs/OMNI-CHANNEL.md` (read before touching a cross-engine surface). It commits and pushes every pass, path-limited.
  **No public file points into it** (no path, session name or run code). Probe and WIP branches push only to the
  private archive remote, never to public origin.
- **Audits and TODO are private because they are pre-fix.** Security issues go through GitHub private advisories
  (`SECURITY.md`); the patch commit is itself a disclosure, so it is developed in the advisory's fork and released first.
  (While nobody uses Vera, Brian has ruled fixes go the normal flow — 2026-09-29, reaffirmed 2026-11-20; ask him again
  once there are users.)
- **`vera-js/vera-archive`** (private): retired packages, archived branches. **`vera-js/vera-private`**: frozen.

Layout: `packages/` (published, independent), `examples/` (by hand), `tests/` (self-running), `bench/` (not a workspace
member: `cd bench && npm install`), `docs/` (public), `internal/` (private, gitignored).

`@verajs/motion` is its own package; `@verajs/directives/motion` is its pack.

## 11. Versioning and release

- **Independent versions** via changesets (read `docs/RELEASING.md` first). **While 0.x, minor is breaking**: features
  and fixes are `patch`.
- The loop, in order: `npx changeset version` → `npm install --package-lock-only` → `git add -- <the changed paths>` and
  `git commit -F <file>` ("release: …") → the full gate on that commit → `node scripts/tag-release.mjs` (tags HEAD; the gate's `tag-release` step is red on the version commit
  until this runs, by design) → push the commit and its release tags in ONE atomic push, by name:
  `git push --atomic origin HEAD:main $(git tag --points-at HEAD)` (the release waits for CI, and CI is red on a version
  commit whose tags are not there yet; `--follow-tags` also pushes any old local annotated tag, 2026-11-20).
- CI publishes what `main` has that npm lacks, via **Trusted Publishing** (OIDC): `release.yml` keeps its name; a new
  package's first publish is manual; `repository.url` stays `git+https://github.com/vera-js/vera.git`; **never an
  `NPM_TOKEN`**. `shared-types`/`shared-utils` are private, inlined.
- The "on npm" status sentences in `llms.txt` and `README.md` change only at the publish (`tests/release-invariants`).

## 12. Context limits

User settings hold `autoCompactEnabled: true` and `CLAUDE_CODE_AUTO_COMPACT_WINDOW: "500000"` (never a PCT override).
Past 450k: a handoff of ≤ 40 lines (goal, shas, next step, files, questions), then ask Brian for `/compact`. Agents: ≤ 2,
one task each, respawned from a handoff.

## Known gaps

- A separate wcc experiment (Brian's account) is an open discussion needing experiments, not a decision.
