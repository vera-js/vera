import type { StoreKit } from '@verajs/inserts';
import type { Untracked } from '@verajs/shared-utils';

/**
 * A component element, carrying what `init` and the hooks attach to it.
 *
 * **Every field core keeps on an element is SIGILED** (2026-10-10) — `_$g$` generation, `_$h$` hooks, `_$r$` root, `_$c$` cleanups, `_$x$` removed, `_$d$` document, `_$m$` moved, `_$s$` pending setup, `_$o$` the
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
   * under and does nothing when it no longer matches — see core's immediate hook (internal).
   */
  _$g$?: number;
  /**
   * Cleanups OTHER packages register for removal (`@vera-hooks/light-dismiss`' `lightDismiss`, `@vera-components/select` — created with `??=`), run
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
  /**
   * The props STORE over `_$raw$`, cached (2026-10-21): every props accessor — adopted and declared — reads through
   * it (`propsOf`), so one record has one store, and core's teardown releases both at a real removal (Firefox keeps a
   * removed element's fields alive until its cycle collector frees the node — BROWSER-LEDGER).
   */
  _$v$?: Record<string, unknown>;
  /** Non-element owners created while this element was being set up (a `computed`'s): retired with it. */
  _$o$?: ComponentElement[];
}

/** What core's immediate hook (internal) registers: the callback, its priority, and optionally its owner. */
export type Hook = {
  /** Run on the first pass and again whenever a store it read changes; anything not a function is refused at the call. */
  callback: HookCallback;
  /** The owner, instead of the element being set up — an element, or any object owning a value. */
  element?: ComponentElement;
  /** Lower runs earlier; `0` is legal and the earliest. */
  priority: number | null;
};

/** Returned from an effect to undo whatever it set up; run before its next run. */
export type HookCleanup = () => void;

/**
 * A hook's callback: handed the signal that woke it, and `init` on the first pass. Returns nothing, a cleanup, or — an `async` callback — a promise, which runs but is never a cleanup (only a function
 * is; development names an async callback once).
 */
export type HookCallback = <V>(change?: Change<V>, init?: boolean) => void | HookCleanup | PromiseLike<unknown>;

/** An element's hooks in run order: sorted by `_priority`, then `_sequence` (creation). */
export type Hooks = HookRecord[];
/**
 * **One key's CELL** (2026-10-19): the hooks that read the key, held STRONGLY, each with its link's index in
 * that hook's source list. The FIRST reader sits inline (`_first`, its slot `_firstAt`); the arrays `_readers` / `_readerAt` exist only from a
 * second reader (position k ≥ 1 is `h[k − 1]` / `j[k − 1]`). Most keys have one reader, so a key costs one allocation:
 * cells as two arrays in an object were three, and a store row reading two fields allocated twice what it had (the
 * Chrome create10k profile, +16 ms per create). Objects and numbers never share an array — Firefox's cold code pays
 * ~25% when they do (BROWSER-LEDGER). Every field is assigned at creation: one shape.
 *
 * Readers keep SUBSCRIPTION ORDER. A leaving reader leaves a TOMBSTONE (`undefined`); `_positions` counts positions, tombstones
 * included, and `_tombstones` counts them. Once they pass half the positions the cell compacts in one stable pass
 * (amortized O(1) per leave). Only a compaction moves readers, so only it bumps `_moves` (which wraps): a wake in progress
 * that sees `_moves` change restarts. There is no `WeakRef` — a `deref()` costs 17–36 ns per wake (BROWSER-LEDGER) — so a
 * hook is unlinked exactly at its retirement.
 */
export type Cell = {
  /** The first reader, inline, and its slot in that reader's `_places`. */
  _first: HookRecord | undefined;
  _firstAt: number;
  /** Readers from the second on, and their slots (both absent until a second reader). */
  _readers: (HookRecord | undefined)[] | undefined;
  _readerAt: number[] | undefined;
  /** Bumped (wrapping) by each compaction: a wake in progress that sees it change restarts. */
  _moves: number;
  /** Positions in use, tombstones included, and how many of them are tombstones. */
  _positions: number;
  _tombstones: number;
};
/**
 * What core keeps ON a raw object about it (under a symbol private to each copy of core): `_owner` the owner (inheritance-safe),
 * `_store` its store (or `null`: hand back verbatim), `_record` whether it is a DATA RECORD (`1` yes, `0` no, `undefined` not yet asked).
 */
export type Slot = {
  /** The object the slot belongs to (a slot is inherited through a prototype, so it names its own object). */
  _owner: object;
  /** Its store, or `null`: hand the object back as it is. */
  _store: object | null;
  /** Whether it is a DATA RECORD: `1` yes, `0` no, `undefined` not asked yet. */
  _record: 0 | 1 | undefined;
};

/**
 * **A hook — ONE object, every field declared** (2026-10-11): no closure, context or expando per hook. Core's
 * `HookState` class is the only implementation; outside core only the keyed module touches one (it reads `$runs` and
 * calls `$n`: `CrossBundleHook`).
 *
 * Subscriptions, kept ON the hook so it can leave them (exact unsubscription): `_sources`/`_places` below, the cells it
 * reads and its place in each. Retiring unlinks it from every one, so a removed component leaves nothing in a store.
 * The links are strong, so retirement is what releases them.
 *
 * **Run order is `_priority`, then `_sequence` (creation: parent-first, then registration order) — two fields,
 * never one packed number.** A packed `priority × 1e9 + sequence` (2026-10-08 → 10-11) misordered close fractional
 * priorities, collided past priority ≈ 9e6 (2^53), and — the sequence being global — read a priority-50 hook as 51 once
 * a page had created 1e9 hooks. The scheduler's fields: `_owner` is the owner whose window a deferred flush waits on, `_queued` says it is queued now, and
 * `_flush`/`_flushRuns` are the flush its runs are counted in and the count.
 */
export type HookRecord = {
  /** The owner: an element, or any object owning a value (a `computed`'s). */
  _owner: ComponentElement;
  /** The owner's generation when the hook was made; any other value retires it. */
  _generation: number | undefined;
  /** Its priority (lower runs first) and its creation sequence — two fields, compared in that order. */
  _priority: number;
  _sequence: number;
  /** 0 immediate (core-internal: runs inside every write), 1 queued (one run per flush), 2 sync (`effect`'s `timing: 'sync'`). */
  _mode: number;
  /** The cleanup the last run returned. */
  _cleanup: HookCleanup | undefined;
  /** The signal of the first write since the last run. */
  _change: Change<unknown> | undefined;
  /** Whether it is queued for the current flush now. */
  _queued: boolean;
  /** The flush its runs are counted in, and how many it ran there (a self-feeding loop is held past the second). */
  _flush: number;
  _flushRuns: number;
  /**
   * **Its sources, with in-order link reuse**: `_sources` is ONE flat array, `[cell, at, cell, at, …]`:
   * each cell it reads and where it sits in that cell. `$runs` counts its runs (0: never run). `_cursor` is the run's cursor INTO
   * `_sources` (it steps by 2): `-1` on a FIRST run, which links each read directly (lazy reuse: a hook never re-run pays
   * nothing for reuse); from the second run, a read matching `_sources[_cursor]` just advances it, and the first read that DIFFERS
   * unlinks the rest at once and links directly from there (`-2`), so every read is linked the moment it is made (a run
   * that reads a key and then writes it must hear its own write). After a run that never diverged, what it did not
   * reach (`_sources[_cursor..]`) leaves. A repeated read needs no stamp: it is skipped when the key's LAST link is this hook's and
   * was made this run (`track`). `_lastWake` is the last
   * wake that reached it, so one write wakes it once.
   */
  _sources: Cell[];
  /** Where it sits in each of those cells (the slot `_sources[k]` holds it at). */
  _places: number[];
  /** Its run count, read by another bundle: see `CrossBundleHook`. */
  $runs: number;
  /** The run's cursor into `_sources` (steps by 2; `-1` first run, `-2` diverged). */
  _cursor: number;
  /** The last wake that reached it. */
  _lastWake: number;
  /** Development: the last run queued by a hold, its run of consecutive held frames, and the hook that queued it. */
  _heldAt?: number;
  _heldFrames?: number;
  _heldBy?: HookRecord;
  /**
   * **The ONE place a hook is handed a change** — a write reaching it, a first pass, or a caller running the hook
   * core's immediate hook (internal)/`effect` with a `priority` returned. The single tracked-run choke point native signals would plug into.
   */
  $n(signal?: Change<unknown>, init?: boolean): void;
  /** The queued pass: run once, with the first write's signal since the last run. */
  $q(): void;
};

/** A component's render: the function its setup returned (or a static value), drawn through the renderer */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RenderTemplate = <V>(change?: Change<V>) => any;

/** The root a component renders into: `'open'` / `'closed'` shadow, `false` for light DOM, or any `ShadowRootInit`. */
export type ShadowOption = 'open' | 'closed' | false | ShadowRootInit;
/**
 * What happens to FOREIGN NODES — nodes placed in a component's root by anything other than its own template (a browser
 * extension, a third-party script, code appending by hand). `'drop'` (the default): the template owns the root — an
 * ordinary re-render touches nothing it did not render, and a template CHANGE (a different template, text, a list,
 * nothing) clears the root, foreign nodes included; development says so. `'preserve'`: the root keeps two marker
 * comments around the template's range, and everything outside the range stays where it is. A container handed to
 * `renderInto` directly (`document.body`, `#app`) always preserves.
 */
export type ForeignNodesOption = 'preserve' | 'drop';
declare global {
  /**
   * **The option keys modules own** — empty here; a module adds its key with `declare global { interface
   * VeraInitOptions { observeSlots?: 'lazy' | 'eager' } }` (slots does), so the key exists only where that module is imported, and
   * core hands it through to the module's `'init'` hook. GLOBAL rather than `declare module '@verajs/core'`: a module
   * that does not depend on core (the renderer's) cannot augment a module it cannot resolve (TS2664).
   */
  // eslint-disable-next-line no-restricted-syntax, @typescript-eslint/no-empty-object-type -- merging IS the point: modules add their keys
  interface VeraInitOptions {}
}
/**
 * `init({ host, …options }, setup?)`'s first argument: the element, with the options that travel with it — core's own,
 * and every key a wired module added to `VeraInitOptions`.
 */
export interface InitOptions extends VeraInitOptions {
  host: ComponentElement;
  shadow?: ShadowOption;
  foreignNodes?: ForeignNodesOption;
  /**
   * **Seconds a REMOVED component stays paused before it is torn down** (2026-10-22). Paused, its effects' cleanups have
   * run and its state and DOM are kept; re-added in time it resumes (every hook runs once, the render included). Default
   * 0: torn down at removal. A value that is not a finite number of seconds, 0 or more, is 0 (development says so).
   */
  persist?: number;
}
/** `define`'s options: the tag, then everything `init` takes but the host (one object per tag, shared by its instances). */
export type DefineOptions = Omit<InitOptions, 'host'> & {
  tag: string;
  /**
   * `false`: build the class and return it WITHOUT registering it, for a caller that registers it itself (a scoped
   * registry, a tag of the user's choosing: `customElements.define(myTag, Class)`). Default: registered under `tag`.
   */
  register?: boolean;
};
/** The class `define` returns: its instances are components carrying the methods. */
export type DefinedClass<M> = { new (): ComponentElement & M; prototype: ComponentElement & M };
/**
 * A component's setup: runs ONCE per connect, untracked, with the element as `host`, and returns its render function
 * (or nothing, for a side-effect setup; or a promise of either, for an async one).
 */
export type Setup = (host: ComponentElement) => unknown;

/** Types `@verajs/lite` speaks too: shared-types', re-exported, so core's public surface is unchanged. */
export type { Camel, Methods, ResultType, Signal, TemplateResult, WithAttributes } from '@verajs/shared-types';

/** `effect()`'s options (2026-10-22): when it runs, its order within a flush, and an owner that is not the component being set up. */
export type EffectOptions = { timing?: 'layout' | 'sync'; priority?: number; owner?: object };
/** What `effect()` returns: `run()` runs it now; `stop()` ends it for good (its cleanup runs once). */
export type Effect = { run(): void; stop(): void };
/** `signal`'s one option: `{ deep: true }` holds the value in a store, so mutating inside it notifies too. */
export type DeepOption = { deep?: boolean };

/**
 * **What a write was — ONE read-only object per write, shared by every hook it reaches** (2026-10-11: `trigger`
 * makes one per write, not one per subscriber; every first pass shares one `{}`). Nothing compares a change's
 * identity, writes to it, or aborts through it — and nothing may: a per-hook field here (a run id, an abort controller)
 * would leak one subscriber's state into all of them. Per-hook state belongs on the hook. It names which property
 * changed, and its value after and before.
 */
export type Change<V> = {
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

/** A module's automatic list map (`$M`, the keyed module's `lists`): a store array's `map(fn)` in a render handed to it. */
export type AutoMap = (proxy: unknown, raw: unknown[], fn: unknown, parent: HookRecord, owner: unknown, method: (...args: unknown[]) => unknown[]) => unknown[];

/** Something a hook's run owns: `$r` the run that last claimed it, `$h` its owning hook, `$d()` its disposal. `$`-named: cross-bundle. */
export type Owned = { $r: number; $h: HookRecord | undefined; $d(): void };

/**
 * **What another bundle reads off a hook RECORD itself** (Brian's ruling, 2026-11-13), declared like `CoreSeams`: a seam
 * hands a module core's functions, but the renderer's keyed module also holds a parent hook (a list's `parent`) and
 * reads it directly. `$`-named, so no bundle's mangler renames them; a field here is renamed in every reader at once or
 * not at all, and `tests/cross-bundle-hook.test.mjs` holds both production bundles to it.
 *
 * Readers: `@verajs/renderer`'s keyed module (`List.parent`: it compares `$runs` with the run its lists were last
 * mapped and committed in, and calls `$n`). The hook's OWNER crosses too, through the sigiled `_$g$`, `_$x$` and `_$h$`
 * declared on `ComponentElement` (a keyed row is an owner).
 */
export type CrossBundleHook = {
  /** Its run count: incremented at the start of every run. */
  $runs: number;
  /** Its notify entry: a change, or the first run (`init`), reaches the hook through it. */
  $n(signal?: unknown, init?: boolean): void;
};

/**
 * **The seams: what core shares with modules in other bundles, through `$`-named fields on the registry** (
 * 2026-11-11). A module never imports core at runtime (a production bundle inlines its own copy), so it reaches core
 * only through these, on the registry `wire` hands it. Declared once, here; sigiled, so no bundle's mangler renames
 * them. Core reads and writes them through `seams` (services/seams.ts), the one cast of the registry to this type.
 * Where each is SET, its why is written beside the assignment.
 */
export type CoreSeams = {
  /** Set by the renderer once it has built a template; development's late-wire warning reads it (`wire`). */
  $b?: boolean;
  /** The app default for `foreignNodes` (set by a module, read at every connect: defined up front, so a read is a hit). */
  $F?: ForeignNodesOption;
  /** The app default for `shadow` (as `$F`). */
  $S?: ShadowOption;
  /** Set by the hot-reload module: a tag defined twice is a reload, not a mistake (`define`'s warning reads it). */
  $hot?: true;
  /** Set by native-elements: built-in hosts are supported (`init`'s development check reads it). */
  $ne?: unknown;
  /** The keyed module's automatic list map (`lists`). */
  $M?: AutoMap;
  /**
   * Development: set by the FULL renderer's connect (`connectTo`) — automatic lists commit their rows through it, and a
   * bare render descriptor never connects. `mapped`'s `lists-no-renderer` warning reads it (Brian's ruling, 2026-11-12).
   */
  $rn?: true;
  /** Development: every copy of core's store re-decision, pushed at load and called on a store wire. */
  $rs?: (() => void)[];
  /** Core's tracking control, `untracked`. */
  $t: Untracked;
  /** A QUEUED hook for an explicit owner (a keyed row's), the record itself. */
  $q: (owner: ComponentElement, callback: HookCallback) => HookRecord;
  /** Retire an owner's hooks. */
  $z: (owner: ComponentElement) => void;
  /** A keyed row's BARE hook: no owner list, retired directly. */
  $qb: (owner: ComponentElement, callback: HookCallback) => HookRecord;
  /** Retire one bare hook. */
  $zh: (hook: HookRecord) => void;
  /** A hook's owner. */
  $ow: (hook: HookRecord) => ComponentElement;
  /** A module claims something for the current run of a hook. */
  $own: (hook: HookRecord, item: Owned) => void;
  /** Settle what a hook's runs own (`all`: dispose everything). */
  $so: (hook: HookRecord | undefined, all?: boolean) => void;
  /** A server render's turn: `$ss(1)` opens, `$ss(-1)` closes and unlinks; `$ss(0)` asks whether one is open. */
  $ss: (delta: number) => unknown;
  /** Core's setup for a built-in host (`initWith`). */
  $in: (element: ComponentElement, options: InitOptions | undefined, given: Setup | undefined) => void;
  /** A removal's whole teardown (`retireElement`). */
  $td: (element: ComponentElement) => void;
  /** A move into another document (`rehomeElement`). */
  $rh: (element: ComponentElement) => void;
  /** This copy's component mark (`MINE`). */
  $m: symbol;
  /** A store array's raw walk under one subscription (`walkItems`). */
  $w: (list: unknown, visit: (raw: unknown, item: unknown) => void, from?: number, to?: number) => boolean;
  /** Its raw read without a subscription (`rawItems`). */
  $wr: (list: unknown) => unknown[] | undefined;
  /** Core's store machinery for a module with stores of its own; position 0 is its protocol. */
  $s: unknown[];
  /** The store kit (`track`'s): what a store module is handed. */
  $k: StoreKit;
  /** Set by the renderer: release what its part holds of a removed component. */
  $x?: (element: Node) => void;
  /** Set by the renderer: clear a released root before a re-init. */
  $y?: (element: Node) => void;
};
