/**
 * The renderer's cross-file and public types — one `types.ts` at the import-graph root, per
 * CODE-PRINCIPLES §1.
 *
 * **What is here and what deliberately is not.** Everything in this file is a pure data shape: it
 * names no runtime value, so it can sit upstream of every module in the package and nothing here
 * can pull a class into the import graph. The renderer's remaining cross-file types — `Item`,
 * `ListStrategy`, `KeyedResult` — name the `Instance` and `ChildPart` CLASSES in their definitions,
 * which puts them structurally downstream of `renderer.ts`; they stay beside those classes, and
 * §1's "one file at the import-graph root" records that limit rather than pretending otherwise.
 * Restating a class's shape here to satisfy the letter of the rule would create exactly the twin
 * §1 forbids.
 *
 * Moving `ProfileReport` and `OverlayOptions` here dissolved a real cycle: `profiler.ts` imported
 * `OverlayOptions` from `overlay.ts` while `overlay.ts` imported `ProfileReport` back from
 * `profiler.ts`. Type-only, so it was erased and never a runtime cycle — but it is the shape this
 * file's position in the graph exists to make impossible.
 */

/**
 * What a template tag (`html`, `svg`, `mathml`) produces — the compiled shape every renderer entry
 * point accepts, and the one type a consumer normally names.
 *
 * `strings` is the template literal's own `strings` array and is the TEMPLATE'S IDENTITY: the
 * engine interns it per call site, so two literals with identical text are two templates and
 * rendering one after the other is a teardown, not an update. Anything building these by hand must
 * hand back the same array to get an update.
 */
export type TemplateResult = {
  /** 1 = html, 2 = svg, 3 = mathml — the markers core's built-in tags produce. */
  _$litType$?: number;
  strings: TemplateStringsArray;
  values: unknown[];
  /** Set by `keyed()`; drives keyed list reconciliation. */
  key?: unknown;
};

/**
 * The one method every part kind implements, as the instance loop sees it.
 *
 * Deliberately structural rather than a base class: the part kinds share no implementation, and a
 * shape costs nothing at runtime where a class would add a prototype link on the hottest path in
 * the package. `_commit` returns the next value index, so a part that consumes several values
 * advances the loop by more than one.
 */
export type Part = {
  _commit(values: unknown[], index: number): number;
};

/**
 * The state a taken-over `<slot>` hands back.
 *
 * `_$park$` is `$`-sigiled so property mangling cannot touch it — the light-slots seam is a
 * cross-bundle contract and a CDN page meets it across separate bundles. It is called before the
 * instance's DOM is bulk-discarded, so the USER'S slotted nodes are rescued before the renderer
 * throws the rest away.
 */
export type SlotSeamState = { _$park$?: () => void };

/**
 * **An instance hook: per-template behavior for every instance, with nothing on the hot path.**
 *
 * A `'template'` hook sets one as the template's `_$inst$` while the template is built — only
 * templates that need it carry one, so every other instance pays one property read. For every
 * instance of that template the renderer CREATES it calls `$c` BEFORE the first update, with the
 * instance's fresh fragment and the render root (`null` for a commit outside any `renderInto`, such as
 * an applier resolving later) — an instance hydration ADOPTS is never created, so it calls neither
 * `$c` nor `$m`, and slots adopts its `<slot>`s through its own seam instead; `$m`
 * once that first update has committed — so bindings are live, and a `<slot name=${…}>` has its name
 * — with whatever `$c` returned; and `$q` at teardown with whatever `$m` returned. An `undefined` at
 * either step ends the instance's part in it.
 *
 * **Its shape is measured, not chosen for tidiness** (2026-09-26, three engines):
 * - **One object with methods, not closures returned per instance.** The effect shape — a function
 *   returning a mount returning a cleanup — allocated two closures for every slotted instance, and
 *   Chromium showed it: slotted creation +3–4% against the renderer before slots moved out. Here the
 *   instance keeps plain state and the methods live once per template.
 * - **One hook, not a list.** A list costs every hooked instance a loop and Firefox about 3%, plus
 *   79 B. A second consumer composes — its `'template'` hook wraps the `_$inst$` it finds — so the
 *   list's only advantage is paid for by nobody today. `slotDiscovery` runs at priority 10, before
 *   any default-priority hook, so it is the one wrapped.
 *
 * `@verajs/renderer/slots` is the user: it finds the `<slot>`s, hands them to the strategy, and parks
 * the user's nodes at teardown. `$`-sigiled throughout, so it survives property mangling across the
 * bundle boundary.
 */
export type InstanceHook = {
  /** Before the first update: this instance's state, or `undefined` to take no part. */
  $c(fragment: DocumentFragment, root: Node | null): unknown;
  /** After the first update, with that state: what to keep for teardown, or `undefined`. */
  $m(state: unknown, root: Node | null): unknown;
  /** At teardown, with what `$m` kept. */
  $q(kept: unknown): void;
};

/**
 * **Told about every node the renderer inserts, once slots is wired**, so the slots module can mark
 * the render's own output in a light host apart from the user's children. `owner` is `true` for the
 * render root's own output and the placing part's start marker otherwise — the ordering group, and
 * a node the strategy can read: a marker it stamped as the render's own output means a top-level part
 * of the host's own template.
 */
export type OwnHook = (parent: Node, node: Node, owner: true | object) => void;

/** One template identity replacing another at the same position, and how often. */
export type Churn = {
  /** The template that was torn down, rendered readably. */
  from: string;
  /** The template that replaced it. */
  to: string;
  /** How many times this exact swap happened while profiling. */
  count: number;
  /** Where in the DOM it happened, e.g. `main#app > ul.list`. First occurrence only. */
  where: string;
};

/**
 * What `getReport()`, `stopProfiling()` and `profile()` hand back.
 *
 * The number to read first is `rebuilds`, with `churn` naming the culprits: an update commits
 * values into DOM that already exists, while a rebuild tears a subtree down and builds another,
 * and a template that rebuilds every render is the single most expensive mistake available in this
 * renderer. `creates` is not a problem — it is what rendering into an empty slot costs once.
 */
export type ProfileReport = {
  /** Completed top-level `render()` calls. Nested renders are folded into their outermost frame. */
  frames: number;
  /** Total milliseconds spent inside `render()`. */
  ms: number;
  /** The slowest single frame, in milliseconds. */
  slowestFrameMs: number;
  /** Templates committed in place — the good path. */
  updates: number;
  /** Templates rendered into a slot that held nothing. Unavoidable and not a problem. */
  creates: number;
  /** Templates that replaced a *different* template — a teardown, not an update. */
  rebuilds: number;
  /** Rebuilds grouped by template pair, worst first. */
  churn: Churn[];
};

/** How `showProfiler()` places and paces its in-page panel. Every field has a default. */
export type OverlayOptions = {
  /** Corner to pin to. Default `bottom-right`. */
  corner?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** How often to repaint, in milliseconds. Default 400. */
  interval?: number;
  /** Churn rows to show before collapsing the rest into a count. Default 4. */
  rows?: number;
};
