/**
 * A component element, carrying what `init` and the hooks attach to it.
 *
 * **Every field core keeps on an element is SIGILED** (O4, 2026-10-10) — `_$g$` generation, `_$h$` hooks, `_$r$` root, `_$c$` cleanups, `_$x$` removed, `_$d$` document, `_$m$` moved, `_$s$` pending setup, `_$o$` the
 * non-element owners its setup created. The element is the AUTHOR's object: a plain `_root`/`_hooks`, or the single
 * letters production mangled the rest to, collided with a base class's own fields — and core reads them back, so a base
 * class's `_root` crashed the render. No mangling regex matches a sigil, so the names are also the cross-package
 * contract (styles, ui, hooks and directives read them) in every build. Short on purpose: each is written at every
 * access. A new field takes a sigil too; `tests/core-host-fields-collision.test.mjs` fails on anything else.
 */
export interface ComponentElement extends HTMLElement {
  /**
   * The element's hooks, ONE flat list in run order (priority, then creation), created with the first hook. Attached to
   * the element so they are collected with it — the store holds them only weakly.
   */
  _$h$?: Hooks;
  /**
   * How many times this element has been `init()`ed. A hook captures the value it was created
   * under and does nothing when it no longer matches — see `createHook`.
   */
  _$g$?: number;
  /**
   * Cleanups OTHER packages register for removal (`@verajs/hooks`' `useDismiss`, ui's select — created with `??=`), run
   * after the hooks' own, in registration order (see `init`'s `retireGeneration`). Core's effects keep theirs on the hook.
   */
  _$c$?: Set<HookCleanup>;
  /** Set once removal has swept `_$c$`, so a cleanup registered after it runs at once. */
  _$x$?: boolean;
  /** Wrapped at `customElements.define` time to run `_$c$`; an author's own is chained first. */
  disconnectedCallback?: () => void;
  /**
   * The root this element renders into, kept because `element.shadowRoot` is **null for a closed
   * shadow root** — that is what closed means, and it applies to the framework too. Read across
   * package boundaries by the `'render'` insert and by `@verajs/styles`, so it is a cross-boundary
   * contract and must never be mangled.
   */
  _$r$?: ShadowRoot;
  /**
   * What a parent's property bindings delivered before this element could receive them, recorded by
   * `@verajs/renderer` (template parts and `spread`) and drained by `init()` into reactive accessors
   * (`adoptProps`). A cross-BUNDLE contract: the recorders live in separately built bundles on a CDN
   * page, so the `_$…$` sigil keeps the name stable under mangling. Absent when nothing was bound.
   */
  _$props$?: Record<string, unknown>;
  /**
   * The live half of the same contract: installed once per element, and a property delivered AFTER the
   * drain — a hydrated child whose parent commits late, a spread bag growing a key — is handed here.
   */
  _$adopt$?: (key: string, value: unknown) => void;
  /**
   * The delivered values, RAW: the target of the store behind the accessors (the store writes raw values into it).
   * What a parent's `!name` compares against — reading through the accessor costs a store read on every render and
   * hands an object back as its proxy, which never equals the object bound. Created with the store, so a component
   * that received nothing has none. **READ-ONLY by contract:** it is the store's raw target, so a write through it
   * changes the value without notifying anything that read it — every write goes through the accessor.
   */
  _$raw$?: Record<string, unknown>;
  /** Non-element owners created while this element was being set up (a `computed`'s): retired with it. */
  _$o$?: ComponentElement[];
}

/** What `createHook` registers: the callback, its priority, and optionally its owner. */
export type Hook = {
  /** Run on the first pass and again whenever a store it read changes. */
  callback: HookCallback | null;
  /** The owner, instead of the element being set up — an element, or any object owning a value. */
  element?: ComponentElement;
  /** Lower runs earlier; `0` is legal and the earliest. */
  priority: number | null;
};

/** Returned from an effect to undo whatever it set up; run before its next run. */
export type HookCleanup = () => void;

/** A hook's callback: handed the signal that woke it, and `init` on the first pass. */
/**
 * Returns nothing, a cleanup, or — an `async` callback — a promise, which runs but is never a cleanup (only a function
 * is; development names an async callback once).
 */
export type HookCallback = <V>(signal?: Signal<V>, init?: boolean) => void | HookCleanup | PromiseLike<unknown>;

/** An element's hooks in run order: sorted by `_k` (priority, then creation). */
export type Hooks = HookRecord[];
/** One key's subscribers: each hook's single `WeakRef` (a hook's element holds the hook strongly, the store weakly). */
export type Subscribers = Set<WeakRef<HookRecord>>;

/**
 * **A hook — ONE object, every field declared** (work queue 5, step 1, 2026-10-11). It replaced three closures, two
 * contexts and expandos on functions per hook. Core's `HookState` class is the only implementation; nothing outside
 * core reads these fields except through `$n`.
 *
 * Subscriptions, kept ON the hook so it can leave them (exact unsubscription, R1 #11): `w` is its one `WeakRef` (what a
 * store's Sets hold), `a`/`b` the first two Sets it joined (a render reads one or two keys) and `d` the rest. Retiring
 * deletes `w` from each, so a removed component leaves nothing in a store and nothing is ever swept. The joined Sets
 * are held STRONGLY while the hook lives: bounded by what the component reads, released at retirement — not a leak.
 *
 * **Run order is `_y` (priority), then `_k` (creation sequence: parent-first, then registration order) — two fields,
 * never one packed number.** A packed `priority × 1e9 + sequence` (2026-10-08 → 10-11) misordered close fractional
 * priorities, collided past priority ≈ 9e6 (2^53), and — the sequence being global — read a priority-50 hook as 51 once
 * a page had created 1e9 hooks. The scheduler's fields: `_o` is the owner whose window a deferred flush waits on, `_in` says it is queued now, and
 * `_f`/`_r` are the flush its runs are counted in and the count.
 */
export type HookRecord = {
  /** The owner: an element, or any object owning a value (a `computed`'s). */
  _o: ComponentElement;
  /** The owner's generation when the hook was made; any other value retires it. */
  _g: number | undefined;
  /** Its priority (lower runs first) and its creation sequence — two fields, compared in that order. */
  _y: number;
  _k: number;
  /** 0 raw (`createHook`: runs inside every write), 1 queued (one run per flush), 2 sync (`useSyncEffect`). */
  _m: number;
  /** The cleanup the last run returned, and the signal of the first write since the last run. */
  _c: HookCleanup | undefined;
  _q: Signal<unknown> | undefined;
  _in: boolean;
  _f: number;
  _r: number;
  w: WeakRef<HookRecord>;
  a: Subscribers | undefined;
  b: Subscribers | undefined;
  d: Subscribers[] | undefined;
  /** Development: the last run queued by a hold, its run of consecutive held frames, and the hook that queued it. */
  _hf?: number;
  _s?: number;
  _b?: HookRecord;
  /**
   * **The ONE place a hook is handed a change** — a write reaching it, a first pass, or a caller running the hook
   * `createHook`/`useHook` returned. The single tracked-run choke point native signals would plug into.
   */
  $n(signal?: Signal<unknown>, init?: boolean): void;
  /** The queued pass: run once, with the first write's signal since the last run. */
  $q(): void;
};

/** The template that is passed to the renderer is a useRender hook and the render helper function */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RenderTemplate = <V>(signal?: Signal<V>) => any;

/** The root a component renders into: `'open'` / `'closed'` shadow, `false` for light DOM, or any `ShadowRootInit`. */
export type ShadowOption = 'open' | 'closed' | false | ShadowRootInit;
/** `init({ host, …options }, setup?)`'s first argument: the element, with the options that travel with it. */
export type InitOptions = {
  host: ComponentElement;
  shadow?: ShadowOption;
};
/**
 * A component's setup: runs ONCE per connect, untracked, with the element as `host`, and returns its render function
 * (or nothing, for a side-effect setup; or a promise of either, for an async one).
 */
export type Setup = (host: ComponentElement) => unknown;

/** Which kind of template a result is, numbered as lit numbers them: 1 html, 2 svg, 3 mathml. */
export type ResultType = 1 | 2 | 3;

/**
 * The object core's `html`, `svg` and `mathml` tags produce. Structurally compatible with lit-html's
 * `TemplateResult`, so a lit renderer consumes it directly.
 */
export type TemplateResult<T extends ResultType = 1> = {
  _$litType$: T;
  strings: TemplateStringsArray;
  values: unknown[];
};

/** The change that woke a hook: which property, and its value after and before. */
/**
 * **What a write was — ONE read-only object per write, shared by every hook it reaches** (R2.5, 2026-10-11: `trigger`
 * makes one per write, not one per subscriber; every first pass shares one `{}`). Nothing compares a signal's
 * identity, writes to it, or aborts through it — and nothing may: a per-hook field here (a run id, an abort controller)
 * would leak one subscriber's state into all of them. Per-hook state belongs on the hook.
 */
export type Signal<V> = {
  prop?: string;
  value?: V;
  prevValue?: V;
};

/**
 * When a FLUSH runs — the one drain of every queued render, layout effect and effect: handed the flush, and the element
 * whose pass asked for it when there is one (so a scheduler can use that element's own window), it decides WHEN to run
 * it — never whether. The default runs it as a microtask within a per-frame budget, and on the element window's next
 * frame past it; `microtask` is exported (no budget).
 */
export type RenderScheduler = (run: () => void, element?: Element) => void;

/** A reactive store over `T`. */
export type Store<T extends object = object> = T;
