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
