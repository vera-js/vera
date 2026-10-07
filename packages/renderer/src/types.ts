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
 * an applier resolving later) — and for an instance hydration ADOPTS, `$c` too, told `adopted`, with the
 * instance's live elements in template pre-order in place of a root (a live root also holds what its
 * nested parts rendered, so counting from it would find the wrong elements); `$m`
 * once the RENDER that created the instance has finished — so bindings are live, a `<slot
 * name=${…}>` has its name, and the instance is in place in its container rather than in a detached
 * fragment (a nested instance is inserted only when its outer one is) — with whatever `$c` returned;
 * an instance torn down before then never gets `$m`; and `$q` at teardown with whatever `$m` returned. An `undefined` at
 * either step ends the instance's part in it.
 *
 * **Its shape is measured, not chosen for tidiness** (2026-09-26, three engines):
 * - **One object with methods, not closures returned per instance.** The effect shape — a function
 *   returning a mount returning a cleanup — allocated two closures for every slotted instance, and
 *   Chromium showed it: slotted creation +3–4% against the renderer before slots moved out. Here the
 *   instance keeps plain state and the methods live once per template.
 * - **One hook, not a list.** A list costs every hooked instance a loop and Firefox about 3%, plus
 *   79 B. A second consumer composes — its `'template'` hook wraps the `_$inst$` it finds — so the
 *   list's only advantage is paid for by nobody today. `@verajs/renderer/elements` runs at priority
 *   10, before any default-priority hook, so it is the one wrapped — and several consumers share it
 *   as `'element'` claims instead of each writing a hook.
 *
 * `@verajs/renderer/elements` is the user: it asks its claimants about each element once per
 * template and mounts and unmounts their behaviors per instance — slots' `<slot>` claim among them. `$`-sigiled throughout, so it survives property mangling across the
 * bundle boundary.
 */
export type InstanceHook = {
  /**
   * Before the first update: the hook's own state for this instance, or `undefined` to take no part. `root` is the
   * instance's root — the clone's fragment, or its one element for a single-root template (then position 0) — or, for
   * an ADOPTED instance, its elements in template pre-order (position `p` is `root[p]`). The renderer keeps the state
   * in one slot of the instance and hands it back; what is in it is the hook's business.
   */
  $c(root: Node | readonly Element[], renderRoot: Node | null, adopted: boolean): unknown;
  /** Once the render that created the instance has finished, with that state. */
  $m(state: unknown): void;
  /** At the instance's teardown — before or after its mount — with that state. */
  $q(state: unknown): void;
};

/**
 * **What a claimant attaches to an element it claimed** — `@verajs/renderer/elements`. One shared
 * object for every claimed element of every instance of a template; plain method names, which
 * mangling leaves alone, so it crosses the bundle boundary. The `'element'` insert in
 * `@verajs/inserts` is declared with this same shape.
 */
export type ElementBehavior = {
  /**
   * Once per instance, at its creation: before its first update (the clone is inert — a binding position is still its
   * empty placeholder) and before it is connected. `adopted` is true when hydration adopted the server's element.
   */
  create?(element: Element, adopted: boolean): void;
  /**
   * Once per instance, after its first update — bindings committed, the element possibly not yet
   * connected (a host rendered off-page, a row in its batching fragment). `root` is the render root
   * the instance was committed into, `null` outside any render; `adopted` is true when hydration
   * adopted the server's element rather than creating one. Whatever it returns is kept for `unmount`.
   */
  mount?(element: Element, context: { root: Node | null; adopted: boolean }): unknown;
  /** Once, at the instance's teardown, with what `mount` returned — only when that was not undefined. */
  unmount?(kept: unknown, element: Element): void;
};

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

/* ── hydrating light slots: the seams between `hydration`, `hydrate-slots` and `slots` ───────────── */

/**
 * Where hydration's walk stands among a live parent's children: a node, and an offset into it when it is text — server
 * text runs arrive MERGED (`a${x}b` is one text node), so a static and a value share a node until the walk splits them.
 * `hydrate-slots` moves it past a filled slot's range. Plain names, so property mangling leaves them alone.
 */
export type HydrationCursor = {
  parent: Node;
  node: Node | null;
  offset: number;
  /**
   * Walking a LIGHT host's children in light order (`hydrate-slots`): the list, `node`'s index in it, and how many of
   * them the template must account for — all of a list read from the server's statement, none of a live record's (a
   * node the page added since is the host's, not the template's). ABSENT on every other walk, so a page without light
   * hosts walks one three-field shape: carrying them on every cursor cost Chrome's hydrate 14% (measured 2026-10-07).
   */
  light?: Node[];
  at?: number;
  end?: number;
};

/** Hydration's mismatch: records the cause and the first node that disagreed, and stops the adoption by throwing. */
export type HydrationFail = (cause: string, at: Node | null, reason: false | (() => string)) => never;

/** A served light host as hydration sees it: only its carrier (`<vm-unassigned>`), which the walk passes over. */
export type ServedHost = { readonly carrier: Node | null };

/**
 * Slots' `capture` (`_$capture$`): a light host's light children, in light order, captured wherever they stand — the
 * server's carrier, when given, becoming the holding.
 */
export type LightCapture = (host: Element, before: Node | null, nodes?: Node[], carrier?: HTMLElement | null) => unknown;

/** Slots' seam (`_$capture$`), stamped with the package's seam protocol: its `capture`, and a host's light children as its record holds them (`null` without one). */
export type CaptureSeam = [protocol: number, capture: LightCapture, lightNodes: (host: Element) => Node[] | null];

/**
 * **Hydrating light slots is its own piece** (`@verajs/renderer/hydrate-slots`): hydration calls it through these
 * positions (`_$hydrateSlots$`), stamped with the package's seam protocol — open a served host, take a filled slot's
 * range at a canonical `<slot>` (its detached copy, or `null`), close a matched walk, rescue a mismatched one.
 */
export type HydrateSlots = [
  protocol: number,
  open: (host: Element, fail: HydrationFail) => ServedHost,
  slot: (canonical: Element, cursor: HydrationCursor, served: ServedHost) => Element | null,
  close: (served: ServedHost) => void,
  rescue: (served: ServedHost) => void,
  /**
   * The cursor that walks a light host's children in light order, for a template placing content into it — over the
   * live record's list, else the statement's (strict) — or `null`: walked as its DOM stands. Given the canonical
   * element, its adoption's plan and values, so a RUN written among those children (a value that is not text) can decline.
   */
  light: (host: Element, canonical: Element, plan: ReadonlyMap<Node, readonly number[]>, values: readonly unknown[]) => HydrationCursor | null,
  /** The walk's step, light-aware: the next light child on a light cursor, else the next sibling. Hydration adopts it once the piece is wired. */
  next: (cursor: HydrationCursor, node: Node) => Node | null,
];
