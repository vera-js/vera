/**
 * The directive contract — DESIGN-DIRECTIVES §2, as refined by §19.1. These words face every
 * directive author; keep them exactly as the design doc records them.
 */
import type { Parsed, ParsedObject } from '@verajs/shared-utils';

/**
 * What `setup` hands back: the ONE-TIME release for wiring that outlives values — a listener, an
 * observer, a region, a timer. Called once, when the instance is destroyed (the element left the
 * document, or its attribute changed and the engine is rebuilding the instance), after the last
 * `Cleanup` has run. A throw here is caught and recorded as `teardown-threw`, not propagated.
 */
export type Teardown = () => void;

/**
 * What `apply` hands back: the PER-RUN undo. `apply` re-runs on every state change it read, and
 * the engine calls the previous run's cleanup before each re-run as well as at destruction — so a
 * cleanup unwinds exactly one run's effects and never setup's.
 *
 * Structurally identical to `Teardown` on purpose; the two names exist because the lifetimes are
 * not, and a directive's source should say which one it is returning.
 */
export type Cleanup = () => void;

/**
 * The directive's handle on the element it is running for — built per element×directive at
 * activation, and the only way a directive touches state, evaluates values or refuses.
 *
 * Two things a reader cannot see in the shape. **Reads subscribe**: `get` and `eval` run inside
 * the engine-owned hook that wraps `apply`, so touching a key is what makes this directive re-run
 * when that key changes — there is no subscription call, and a read moved out of `apply` silently
 * stops tracking. And **the element and attribute are already bound in**, which is why `reject`
 * takes only a code: the engine knows which directive on which element is refusing, so a
 * directive never names itself.
 */
export type Ctx = {
  /** Read a context key (nearest OWNER; `@key` reads the page store). Dotted tails walk own props. */
  get: (key: string) => unknown;
  /** Write a context key (owner, else nearest carrier; `@key` writes the page store). */
  set: (key: string, value: unknown) => void;
  /** Run a parsed assignments object — every write goes through the store. */
  run: (assignments: ParsedObject) => void;
  /**
   * Re-read a `data-vd-*` attribute on this element NOW and run it as an assignments object —
   * the dispatch-time primitive for event directives (delegation reads fresh text at fire time,
   * so swapped-in markup behaves from its first event). Unparseable or non-object values become
   * rejections, never throws.
   */
  runAttr: (attr: string) => void;
  /** Evaluate one parsed value against this element's context (paths resolve, literals pass). */
  eval: (value: unknown) => unknown;
  /** The family match result, when this directive was claimed through a `{ match }` name. */
  selection: unknown;
  /**
   * Record a refusal in the rejections registry (dev prints once per code×directive).
   *
   * Pass an ARRAY (or nothing) for a code this package documents, and the engine supplies the
   * sentence from its diagnostics table — that is how the shipped packs do it, so their prose
   * folds out of production entirely. Pass a STRING to write your own words, which is the path a
   * third-party directive takes: its codes are not in that table and its bytes are its own.
   */
  reject: (code: string, messageOrArgs?: string | readonly unknown[], fix?: string) => void;
};

/** How the engine parses an attribute's text before the directive sees it. */
export type ValueClass = 'literal' | 'expression' | 'object' | 'none';

/**
 * What `apply` and `ssr` RECEIVE for a given value class — the design's §17.11 promise, made real.
 *
 * The one that earns this on its own is `object`. An object-valued attribute arrives with its
 * entries STILL PARSED: `{ url: endpoint, method: 'GET' }` hands over a path node and a string, not
 * two strings, because the whole point is that each entry may be evaluated against context at the
 * moment it is used — that is what lets a fetch's configuration be built from state. Typed as
 * `unknown` it read as an ordinary object and `remote` used it as one, sending the literal text of
 * an expression as a URL. `ParsedObject` makes the compiler ask for `ctx.eval` instead of a code
 * reviewer noticing.
 *
 * `expression` stays `unknown` honestly: an expression evaluates to whatever it evaluates to.
 */
export type ValueOf<K extends ValueClass> =
  K extends 'literal' ? string
  : K extends 'object' ? ParsedObject
  : K extends 'none' ? undefined
  : unknown;

type DirectiveOf<K extends ValueClass> = {
  /** The suffix after `data-vd-`, or a family matcher returning parsed selection args or null. */
  name: string | { match: (suffix: string) => unknown | null };
  /** How the engine parses the attribute text BEFORE the directive sees it. */
  value: K;
  /**
   * Once per element×directive: wiring that is not value-dependent. May return a teardown, or
   * `{ apply, teardown }` — an apply returned here closes over setup's locals, so per-instance
   * state is ordinary closure variables.
   */
  setup?: (el: Element, ctx: Ctx) => void | Teardown | {
    apply?(el: Element, value: ValueOf<K>, ctx: Ctx): void | Cleanup;
    teardown?: Teardown;
  };
  /**
   * The reactive half. Runs INSIDE AN ENGINE-OWNED HOOK: reading context state subscribes, a
   * write re-runs it on core's scheduler, and a returned function is the per-run cleanup.
   *
   * **Declared as a METHOD, not a property, and that is load-bearing.** Method parameters are
   * checked bivariantly, which is what lets the engine hold every directive in one collection and
   * call one `apply` over the union — a property-typed callback would make the union's shared call
   * signature `never` and force a cast at exactly the boundary the types exist to protect.
   */
  apply?(el: Element, value: ValueOf<K>, ctx: Ctx): void | Cleanup;
  /** Order among directives on ONE element. Lower first: state=10, reflections=50, events=70. */
  priority?: number;
  /** Introspectable documentation — REQUIRED on shipped packs; feeds describeDirectives(). */
  docs?: { summary: string; example: string };
  /**
   * What this directive does during a SERVER render (design §9), where there is markup and state
   * but no events, no timers and no client.
   *
   * Absent — the safe default — means BEHAVIORAL: nothing to say before an event exists. That is
   * not a limitation for handlers, which need no server pass at all: the handler lives in the
   * attribute and delegation matches it at dispatch, so a server-rendered page is interactive the
   * moment the engine boots, with no per-element hydration.
   *
   * `true` means DECLARATIVE and server-safe: the engine resolves this directive's apply exactly
   * as it does in a browser (a plain `apply`, or the one a `setup` returns) and calls it ONCE, so
   * the reflection is already correct in the HTML and the client's first pass re-derives the same
   * answer. Declaring it asserts that `setup` touches nothing a server cannot own — no listeners,
   * no observers, no timers.
   *
   * A FUNCTION is the escape hatch for a directive whose client path is not server-safe but which
   * still has a server truth to write: it receives the evaluated value and writes the markup.
   */
  ssr?: boolean | ((el: Element, value: ValueOf<K>, ctx: Ctx) => void);
};

/**
 * A directive, DISCRIMINATED BY ITS VALUE CLASS — so `value: 'object'` types its own `apply`, with
 * no type argument at the call site and no annotation an author has to remember. Writing the union
 * out rather than exposing `DirectiveOf<K>` generically is deliberate: it is what makes an object
 * literal narrow on the `value` property, which is the entire ergonomic point.
 */
export type Directive =
  | DirectiveOf<'literal'>
  | DirectiveOf<'expression'>
  | DirectiveOf<'object'>
  | DirectiveOf<'none'>;

/**
 * What the ENGINE holds — the union widened to its most permissive member.
 *
 * Bivariant method parameters let every `Directive` be STORED as one of these, but a union cannot
 * be CALLED: TypeScript intersects the members' parameters and `string & ParsedObject & undefined`
 * is `never`, so `d.apply(el, value, ctx)` is rejected on a value nothing can produce. Widening at
 * the registry boundary keeps the engine's single dispatch path and confines the looseness to the
 * one place that legitimately does not know which class it is holding — an author never sees this
 * type, and an author is who the discrimination is for.
 */
export type AnyDirective = Omit<DirectiveOf<'expression'>, 'value'> & { value: ValueClass };

/**
 * One recorded refusal — the entry `ctx.reject` appends and `rejections()` reads back. A directive
 * declining to act never throws and never stops its siblings; it leaves one of these behind, which
 * is what lets Studio, a test or a devtools panel ask an element why nothing happened.
 *
 * **`message` and `fix` are DEVELOPMENT-ONLY, and a consumer must not build on them.** Production
 * keeps the data a tool can act on — `element`, `directive`, `code` — and folds the prose away
 * entirely (`message` is `''`, `fix` is `undefined`), because the sentences are bytes an end user
 * cannot use. Match on `code`; it is stable and it is what the docs URL is keyed to.
 *
 * `element` is null for a refusal that belongs to the page rather than a node — a bad factory
 * option, a rejection raised before any element was reached.
 */
export type Rejection = {
  element: Element | null;
  directive: string;
  code: string;
  message: string;
  fix?: string;
};

/**
 * The seams an engine CONNECTOR receives — the pack-authoring contract.
 *
 * Declared here rather than in the engine, and imported by packs with `import type`, which is
 * ERASED at build: a pack still emits no runtime import and still cannot reach engine state, so
 * the additive rule holds exactly as before. That rule was always about shared mutable STATE —
 * two bundles owning two registries — and never about types, which have no runtime existence.
 * Four hand-maintained copies of this block is the drift it was costing: a new seam would have
 * been added in one and silently missing from three.
 */
export type EngineSeams = {
  /** The mark a `dual` pack tests to tell "the engine called me" from "the author configured me".
   *  Sigiled, so property mangling cannot touch it across bundle boundaries. */
  _$seams$: true;
  setParse: (parse: (source: string) => Parsed) => void;
  setEvalExpr: (evalExpr: (node: unknown, read: (segments: string[], global: boolean) => unknown, el: Element) => unknown) => void;
  directive: (d: Directive) => void;
  reject: (element: Element | null, directive: string, code: string, messageOrArgs?: string | readonly unknown[], fix?: string) => void;
  /**
   * Invoke a registered ACTION — the value tier's door to `wireActions`.
   *
   * The tier compiles a call to an unknown name into this rather than failing at parse, because a
   * registry is dynamic and a parse-time snapshot of one is wrong. The engine resolves the name,
   * builds the `Ctx` for the element the expression is being evaluated for, and refuses if the name
   * is unregistered or if nothing is currently firing.
   */
  action: (name: string, args: readonly unknown[], element: Element | null) => unknown;
};

/**
 * A PACK: the other thing `wireDirectives` accepts beside a plain `Directive`. The engine calls it
 * once, at wire time, with a fresh `EngineSeams`; the body registers whatever the pack contributes
 * — directives, a parser, a vocabulary — and returns nothing, because a pack's effect is what it
 * put in the registry, not a value.
 *
 * **The discriminator is `typeof === 'function'`**, which is what makes the dual shape possible: a
 * factory that returns one of these is called by the AUTHOR with options, and the connector it
 * returns is called by the ENGINE with seams (see `dual`, and the wireable-module rule in
 * CLAUDE.md). A dual therefore has to tell the two calls apart itself, by testing the seams'
 * `_$seams$` mark.
 *
 * A connector takes its seams from the engine that called it rather than importing engine state,
 * so a pack stays an additive bundle: `import type` here erases at build, and no second registry
 * can come into existence across a bundle boundary.
 */
export type EngineConnector = (seams: EngineSeams) => void;

/**
 * A DOM change offered to the flip door, TYPED — the generalized seam (owner's rule: tables,
 * not conditionals). Every element a commit touches is one of these, and flip.ts's TREATMENT
 * maps the kind to its animation policy. A new way for content to change (an insertion, a
 * linger-removal) is a KIND here, a TREATMENT row there, and a producer in its directive —
 * never another parameter or positional convention on the door.
 *
 * - `move`   — the element travels (list reorder).
 * - `fade`   — visibility flips in place (list filter).
 * - `swap`   — a region's content is replaced (fetch markup swap); old-to-new crossfade.
 * - `enter`  — the element did not exist before this commit (fetch append/prepend); it gets its
 *              own entrance instead of riding a whole-container morph. Enter changes are the one
 *              kind a producer cannot hand over up front — the elements are born inside the
 *              commit — so they arrive through the flip door's `after` producer.
 */
export type ListChange = {
  readonly item: Element;
  readonly kind: 'move' | 'fade' | 'swap' | 'enter';
};

/**
 * The `$` vocabulary the engine ships — the DECLARATION, apart from the engine that registers it.
 *
 * Its own module for the same reason `docs-url.ts` and `scripts/size-modules.mjs` are: something
 * other than the runtime needs to read it. `scripts/sync-diagnostics.mjs` publishes this list into
 * `diagnostics.json` and into the documentation, and a hand-typed second copy of a vocabulary is a
 * copy that drifts — which is how `$x $y $button` came to be written in three places with nothing
 * checking any of them against the code.
 *
 * Getters return PRIMITIVES (design §20.1): deterministic, serializable, and safe to log, diff, or
 * hand to an agent. The engine enforces that in development.
 */
export type Payload = Record<string, (event: Event) => string | number | boolean | null>;
