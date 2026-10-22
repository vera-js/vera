import { diagnostic, misuse } from '@verajs/shared-utils';
import { PROSE } from './keyed-diagnostics.js';
/**
 * @verajs/renderer/keyed — key-based list reconciliation, loaded by the values that need it.
 *
 * `keyed()` stamps a result with its key and with the strategy that reconciles it (`$r`), so importing
 * the marker is what loads the algorithm: nothing registers, and a list names its own strategy. It
 * imports nothing at runtime and reaches the renderer only through the `$`-named list protocol on the
 * part (`$c` create, `$u` update, `$f` first node, `$m` move, `$d` remove) and each item's `$k`, which
 * is what lets it sit beside any renderer entry, hydrate included.
 */
import type { Item, KeyedResult, ListStrategy } from './renderer.js';

/** Development: the duplicate keys already said, per list part. */
let saidKeys: WeakMap<object, Set<unknown>> | undefined;
const reconcile: ListStrategy = (part, values, items, parent, end) => {
  const count = values.length;
  /** A `null` item is unkeyed, as the renderer's `$c` already treats it — never a throw on the second render. */
  const key = (i: number) => (values[i] as KeyedResult | null)?.key;
  let start = 0;
  let oldEnd = items.length - 1;
  let newEnd = count - 1;

  /**
   * The unchanged run at each end, matched without allocating. When what remains between them is only
   * removals (a row deleted) or only insertions (rows appended, prepended, inserted), it is settled here;
   * a same-order update is the case where nothing remains at all.
   */
  /** A row whose value is the result committed last time (a list row that did not re-render) is not even asked. */
  while (start <= oldEnd && start <= newEnd && items[start].$k === key(start)) {
    const value = values[start];
    if (value === undefined || value !== (items[start] as { $j?: unknown }).$j) items[start] = part.$u(items[start], value);
    start++;
  }
  while (start <= oldEnd && start <= newEnd && items[oldEnd].$k === key(newEnd)) {
    const value = values[newEnd];
    if (value === undefined || value !== (items[oldEnd] as { $j?: unknown }).$j) items[oldEnd] = part.$u(items[oldEnd], value);
    oldEnd--;
    newEnd--;
  }
  /**
   * A repeated key, said where it can have arisen: only when the new list has items between the end scans (inserted
   * or moved) — a same-order update and a pure removal cannot create one, and never pay for the check. It behaves
   * correctly in the common case and arbitrarily in the rest — the shape of bug that survives a test suite.
   * Development only; the keys are gathered only here.
   */
  if (__DEV__ && start <= newEnd) {
    const seen = new Set<unknown>();
    for (let i = 0; i < count; i++) {
      const k = key(i);
      if (seen.has(k)) {
        /** Once per (list, key): the same duplicate on every reconcile is noise; a NEW duplicate key is news. */
        const said = (saidKeys ??= new WeakMap()).get(part) ?? new Set();
        saidKeys.set(part, said);
        if (!said.has(k)) {
          said.add(k);
          console.warn(diagnostic('keyed', 'a keyed list', 'keyed-duplicate-key', __DEV__ && PROSE['keyed-duplicate-key'](String(k))));
        }
        break;
      }
      seen.add(k);
    }
  }
  if (start > newEnd) {
    for (let i = start; i <= oldEnd; i++) part.$d(items[i]);
    items.splice(start, oldEnd - start + 1);
    return items;
  }
  /** Joined with `concat`, never spread into `splice`: an engine caps a call's arguments (JavaScriptCore at 65 536). */
  const ref = start < items.length ? part.$f(items[start]) : end;
  const added: Item[] = [];
  if (start > oldEnd) {
    for (let i = start; i <= newEnd; i++) added.push(part.$c(values[i], parent, ref));
    return items.slice(0, start).concat(added, items.slice(start));
  }

  /**
   * A genuine reorder: two-ended from where the scans stopped, with a key map of the old middle built only
   * when both ends miss. An old item the new list no longer holds stays until the final sweep removes it.
   */
  const old: (Item | null)[] = items;
  const next: Item[] = items.slice(0, start).concat(new Array(newEnd - start + 1), items.slice(oldEnd + 1));
  const before = (i: number): Node | null => (i < count ? part.$f(next[i]) : end);
  let map: Map<unknown, number> | undefined;
  /** The new middle's keys, built with `map`: what tells a removed old end from a moved one. */
  let fresh: Set<unknown> | undefined;
  let oldHead = start;
  let newHead = start;
  while (oldHead <= oldEnd && newHead <= newEnd) {
    const head = old[oldHead];
    const tail = old[oldEnd];
    if (head === null) oldHead++;
    else if (tail === null) oldEnd--;
    else if (head.$k === key(newHead)) {
      next[newHead] = part.$u(head, values[newHead]);
      oldHead++;
      newHead++;
    } else if (tail.$k === key(newEnd)) {
      next[newEnd] = part.$u(tail, values[newEnd]);
      oldEnd--;
      newEnd--;
    } else if (head.$k === key(newEnd)) {
      part.$m(head, before(newEnd + 1), parent);
      next[newEnd] = part.$u(head, values[newEnd]);
      oldHead++;
      newEnd--;
    } else if (tail.$k === key(newHead)) {
      part.$m(tail, part.$f(head), parent);
      next[newHead] = part.$u(tail, values[newHead]);
      oldEnd--;
      newHead++;
    } else {
      if (map === undefined) {
        map = new Map();
        for (let i = oldHead; i <= oldEnd; i++) if (old[i] !== null) map.set(old[i]!.$k, i);
        fresh = new Set();
        for (let i = newHead; i <= newEnd; i++) fresh.add(key(i));
      }
      /**
       * **An old end the new list no longer holds is REMOVED, not worked around** (2026-10-20): a push and a middle
       * splice in one flush left no unchanged run at either end, and the walk moved every row past the removed one —
       * 999 `insertBefore` on 1000 rows, where 2 DOM operations are right (`auto-moves.mjs`).
       */
      if (!fresh!.has(head.$k)) {
        part.$d(head);
        old[oldHead++] = null;
        continue;
      }
      if (!fresh!.has(tail.$k)) {
        part.$d(tail);
        old[oldEnd--] = null;
        continue;
      }
      /**
       * A slot the map points at may already be spoken for when a key repeats: nulled by an earlier reuse,
       * or consumed by the two-ended branches (which move pointers without nulling). Either is treated as
       * "not found" and gets a fresh item — duplicate keys are undefined behavior, but undefined must still
       * mean a list, never a throw or a row rendered twice.
       */
      const at = map.get(key(newHead));
      const reusable = at === undefined || at < oldHead || at > oldEnd ? null : old[at];
      if (reusable === null) next[newHead] = part.$c(values[newHead], parent, part.$f(head));
      else {
        part.$m(reusable, part.$f(head), parent);
        next[newHead] = part.$u(reusable, values[newHead]);
        old[at!] = null;
      }
      newHead++;
    }
  }
  const fill = before(newEnd + 1);
  for (; newHead <= newEnd; newHead++) next[newHead] = part.$c(values[newHead], parent, fill);
  for (; oldHead <= oldEnd; oldHead++) if (old[oldHead] !== null) part.$d(old[oldHead]!);
  return next;
};

/**
 * Marks a template result with a stable key, so list reconciliation moves it instead of rewriting it.
 * Key all items in a list or none. A repeated key is undefined behavior: which item keeps the existing
 * node is unspecified, but the render completes and the DOM holds what the list holds.
 *
 * ```js
 * import { keyed } from '@verajs/renderer/keyed';
 * rows.map((r) => keyed(r.id, html`<tr>…</tr>`))
 * ```
 */
export const keyed = <T>(key: unknown, result: T): T => {
  /**
   * The second argument is the one that goes missing — `keyed(row.id)`. It failed with `Cannot set properties of
   * undefined (setting 'key')`, which names this function's internals and not the call.
   */
  if (__DEV__ && (result === null || typeof result !== 'object'))
    throw new TypeError(misuse('keyed', 'keyed-not-template', __DEV__ && PROSE['keyed-not-template'](String(result))));
  (result as KeyedResult).key = key;
  (result as KeyedResult).$r = reconcile;
  return result;
};

/**
 * **Rows that track themselves** (PROBE P1, 2026-10-18; its `each(items, key, row)` API RETIRED 2026-10-21, Brian: the
 * automatic `.map` below replaced it, nothing documented or used it, and it carried its own reconcile and key cache):
 * core's hook machinery gives each row its own subscriber, and the renderer's list part does the walk and the moves. A
 * write a row read wakes exactly that row, which re-commits itself in place through `part.$u`.
 */
type Owner = { _$g$: number; _$x$: boolean; _$h$?: unknown[]; localName: string; readonly isConnected: boolean; readonly ownerDocument: Document };
/** The row's hook, as core's `$q` hands it back: the record itself, run through its `$n` (a `$`-name: survives mangling). */
type RowHook = { $n(signal?: unknown, init?: boolean): void };
type EachPart = { $p(value: unknown): void; $u(item: Item, value: unknown): Item; $i?: Item[] };

/** Core's queued-hook factory (`$q`) and retire (`$z`), handed over by `eachList` when it is wired: a row's subscriber. */
let hook: ((owner: Owner, callback: (signal?: unknown, init?: boolean) => void) => RowHook) | undefined;
/** Core's bare row hook (`$qb`), its direct retire (`$zh`) and the hook → owner read (`$ow`): one object fewer and no closure per row. */
let bareHook: ((owner: Owner, callback: (this: RowHook, signal?: unknown, init?: boolean) => void) => RowHook) | undefined;
let retireHook: ((hook: RowHook) => void) | undefined;
let ownerOf: ((hook: RowHook) => Owner) | undefined;
/** Core's run ownership (`$own`). */
let own: ((hook: unknown, item: List) => void) | undefined;
/** Core's settle (`$so`): a row that owns lists settles them where its run ends, or disposes them as it drops. */
let settle: ((hook: unknown, all?: boolean) => void) | undefined;
/**
 * **How many live lists a ROW owns** (a `.map` inside a row's render), page-wide: while it is 0 — every page without
 * nested lists — a row's run and its drop pay one module read for ownership, and no lookup (what (e′) paid per row).
 */
let nested = 0;
/** Every row's callback, ONE function: core calls it as a method of the row's hook, which leads back to the row. */
function rowCb(this: RowHook, signal?: unknown, init?: boolean) {
  rowRun.call(ownerOf!(this) as Row, signal, init);
}
/** Core's retire (`$z`): what releases a row's subscriptions. */
let retire: ((owner: Owner) => void) | undefined;
/** Core's raw walk of a store array (`$w`), when core is wired; otherwise the list walks itself. */
let walk: ((list: unknown, visit: (raw: unknown, item: unknown) => void) => boolean) | undefined;
/** The render counter: a row stamped with this render's `t` was met in it; one not met is swept (`eachValue`). */
let tick = 0;

/**
 * A row's template result, ready for the list part: its `key` (what reconcile matches on), `$r` (the keyed strategy, so
 * the part reconciles by key) and `_$same$` (opts the result into the identity skip: the renderer may do nothing when
 * the SAME result object comes back, which a list row returns when it did not re-render).
 */
const stamp = (rec: Row) => {
  const r = rec.row(rec.item) as KeyedResult & { _$same$?: number };
  /** An automatic `.map` row may return a string or a number (`.map((t) => t.name).join(', ')`): nothing to stamp. */
  if (r === null || typeof r !== 'object') return r;
  r.key = rec.key;
  r.$r = reconcile;
  r._$same$ = 1;
  return r;
};
/**
 * **A row: its record AND its hook's OWNER, one object; the hook is core's BARE row hook (`$qb`: never in the owner's hook list, retired directly), held in `h`, run through the one shared `rowCb`.** (An earlier version made the row
 * its own hook, a subclass of core's hook class across the bundle boundary: one object per row instead of two. It bought
 * nothing — a Chrome profile of create10k showed the two identical, and two races put it 4–6% SLOWER at Chrome 10k
 * creation — and the cross-bundle subclass cost two mangling bugs; REVERTED, Brian 2026-10-20.) As the owner it carries
 * what core's hooks read of an owner: `_$g$` its generation (bumped by `drop`, which retires the hook), `_$x$` /
 * `localName`, `_$h$` the hook list core keeps on it (declared, so its first write is no shape change), `isConnected` (core
 * skips a disconnected owner's writes; the row is connected while its rendered node is) and `ownerDocument` (the
 * scheduler uses the element's own window). As the record: `part` its list part, `list` its automatic list, `key`,
 * `item` / `row` what it renders from, `result` its last template result, `inst` the instance that result was committed
 * into, `seen` the render that last met it.
 */
class Row {
  /**
   * `declare`d and ASSIGNED in the constructor, in one order — as core's `HookState` is — never class-field initializers
   * (a define-semantics field is a property DEFINITION per instance).
   */
  declare _$g$: number;
  declare _$x$: boolean;
  declare _$h$: unknown[] | undefined;
  declare localName: string;
  declare h: RowHook;
  declare part: EachPart | undefined;
  /** The automatic `.map` list this row belongs to (the only kind of row since `each` was retired, 2026-10-21). */
  declare list: List | undefined;
  declare result: KeyedResult | null;
  declare inst: Item | undefined;
  declare key: unknown;
  declare item: unknown;
  declare row: (item: unknown) => unknown;
  declare seen: number;
  constructor(p: EachPart | undefined, k: unknown, item: unknown, row: (item: unknown) => unknown, t: number, list: List | undefined) {
    this._$g$ = 1;
    this._$x$ = false;
    this._$h$ = undefined;
    this.localName = 'each-row';
    this.h = undefined as unknown as RowHook;
    this.part = p;
    this.list = list;
    this.result = null;
    this.inst = undefined;
    this.key = k;
    this.item = item;
    this.row = row;
    this.seen = t;
  }
  get isConnected() {
    const node = (this.inst as { $R?: Node } | undefined)?.$R;
    return node === undefined || node.isConnected;
  }
  get ownerDocument() {
    return (this.inst as { $R?: Node } | undefined)?.$R?.ownerDocument ?? document;
  }
}
/**
 * The row's run: a write the row's render read wakes exactly this row. It re-stamps and commits its new result into its
 * OWN instance in place (`part.$u`); if the instance had to be replaced (the row's shape changed), the list part's item
 * array is patched to point at the new one.
 */
function rowRun(this: Row, _signal?: unknown, init?: boolean) {
  const list = this.list;
  /** An automatic list the parent's latest run no longer reached: its rows go with it. */
  if (!init && list !== undefined && list.mapped !== list.parent.v) return orphan(list);
  const r = stamp(this);
  this.result = r;
  /** The row's render returned: a nested list it hid this time goes now (core's ownership, settled here — (e″)). */
  if (nested !== 0) settle!(this.h);
  /**
   * A run its LIST asked for (`init`: created, or re-run in the list's walk) only records its result — the list hands it
   * to the renderer. Only a write the row heard commits or wakes anything: a walk-time run that woke the parent made the
   * parent re-run its rows, which woke it again (a loop, measured 2026-10-20).
   */
  if (init) return;
  /**
   * An automatic list's row commits in place only while the page shows what the parent's LATEST run mapped (`committed`);
   * otherwise the map's result was used as a value (summed, joined, chained), so the parent re-renders with it.
   */
  if (list !== undefined && list.committed !== list.parent.v) return list.parent.$n();
  if (this.inst !== undefined) {
    const part = this.part!;
    const out = part.$u(this.inst, r);
    if (out !== this.inst) {
      const items = part.$i!;
      items[items.indexOf(this.inst)] = out;
      this.inst = out;
    }
  }
}
const makeRow = (part: EachPart | undefined, k: unknown, item: unknown, row: (item: unknown) => unknown, list?: List): Row => {
  const rec = new Row(part, k, item, row, tick, list);
  rec.h = bareHook!(rec, rowCb);
  /** `init`: a hook's first run is immediate (a queued hook's write-time run would only enqueue it). */
  rec.h.$n(undefined, true);
  return rec;
};
/** A row that left the list: its generation moves on (it goes inert) and core retires it (a self-owned hook: directly). */
const drop = (rec: Row) => {
  rec._$g$++;
  retireHook!(rec.h);
  if (nested !== 0) settle!(rec.h, true);
  /** A row owns exactly one hook today; if anything ever registers another on it, the full retire still runs. */
  if (rec._$h$ !== undefined) retire!(rec);
};
/**
 * **Automatic `.map`** (PROTOTYPE, Brian 2026-10-20: every `.map` on a store array inside a render is
 * a keyed list, with no rule and nothing to learn). Core's array handler hands `state.todos.map(fn)` here when it runs in
 * a render (`$M`). The result is a REAL array of the row results — `.map(i => i.name).join(', ')` still works — and each
 * `fn(item)` runs once, under its ROW's hook, so the parent never subscribes to row fields: a write to
 * one item re-renders that row. A LIST (below) owns the rows and, as its own hook, the array's shape (`ITEMS`): a push
 * or a splice re-runs the list, not the parent.
 *
 * **The stale-value rule, decided by WHICH hook ran** (signals-readiness constraint 4: no change information is read):
 * the parent's run called `.map` → every row re-runs with the new `fn` (fresh parent values, exactly as a plain map); the
 * list's own hook ran alone → only the shape changed, so unchanged rows are skipped.
 *
 * **Keys:** an item's own `id`, else the item itself — what lets a refetch (`state.todos = await …`) keep the rows of
 * unchanged ids, and their DOM. A repeated `id` turns the list to identity keys for good (development warns,
 * `keyed-duplicate-key`); the same object twice gets a fresh row per occurrence. **A plain map instead** when `fn`
 * declares an index (`(t, i) => …`: a row would show a stale position after a reorder) or the array holds primitives.
 *
 * **Lists are matched to calls by ORDER within the parent's run**, as hooks are: the parent's k-th `.map` is the k-th
 * list. A list the parent's latest run did not reach is an orphan; its next wake retires it with its rows.
 */
class List {
  declare _$g$: number;
  declare _$x$: boolean;
  declare _$h$: unknown[] | undefined;
  declare localName: string;
  declare h: RowHook;
  declare parent: { v: number; $n(signal?: unknown, init?: boolean): void };
  declare owner: Node & { readonly isConnected: boolean };
  declare fn: (item: unknown) => unknown;
  declare items: ArrayLike<unknown>;
  declare cache: Map<unknown, Row>;
  declare recs: Row[];
  declare values: unknown[];
  declare part: EachPart | undefined;
  declare mapped: number;
  declare committed: number;
  declare all: boolean;
  declare ident: boolean;
  declare dead: boolean;
  /** Option (c): the array this list last mapped. */
  declare raw: unknown[] | undefined;
  /** Option (e)'s owned contract (`$`-named, read by core): the parent run that last claimed it, its owning hook. */
  declare $r: number;
  declare $h: unknown;
  constructor(parent: List['parent'], owner: List['owner']) {
    this._$g$ = 1;
    this._$x$ = false;
    this._$h$ = undefined;
    this.localName = 'each-list';
    this.h = undefined as unknown as RowHook;
    this.parent = parent;
    this.owner = owner;
    this.fn = undefined as unknown as List['fn'];
    this.items = [];
    this.cache = new Map();
    this.recs = [];
    this.values = [];
    this.part = undefined;
    this.mapped = 0;
    this.committed = -1;
    this.all = true;
    this.ident = false;
    this.dead = false;
    this.raw = undefined;
    this.$r = -1;
    this.$h = undefined;
  }
  /** Disposed by core when the parent's run ends without claiming it, or the parent hook retires. */
  $d() {
    orphan(this);
  }
  /** Connected while the component that mapped it is. */
  get isConnected() {
    return this.owner.isConnected !== false;
  }
  get ownerDocument() {
    return this.owner.ownerDocument ?? document;
  }
}
/** The mark on a map's result: the list that made it. A Symbol private to this module copy. */
const AUTO = Symbol();
/**
 * The marked array this module is committing right now, so the renderer's own list path takes THAT array — and only
 * it: a row built during the commit carries its own nested list, which must still reach `commitList` (a plain flag
 * turned every nested list away, so every inner write re-ran its outer row — measured 2026-10-20).
 */
let committing: unknown[] | undefined;
/**
 * **Only a map whose rows are TEMPLATES becomes a list** (option C, Brian 2026-10-20 — measured first without the rule:
 * a `map → reduce` over 10k items in a render cost +29% Chrome / +30% Firefox on its first render and twice the heap,
 * 5.63 vs 2.85 MB, for rows nothing renders). A call site's first item decides, ONCE: its row run untracked; a result
 * that is not an object marks the call site `PLAIN` for good, and it maps natively from then on.
 */
const PLAIN = 0;
/** Per parent hook: the run its lists were last counted in, how many it has reached this run, and the lists. */
type ListsState = {
  v: number;
  n: number;
  lists: (List | typeof PLAIN)[];
  /** Option (c): this run's count of maps per array, and each array's slots by occurrence. */
  occ: Map<unknown, number>;
  byRaw: WeakMap<object, (List | typeof PLAIN | undefined)[]>;
};
const listsOf = new WeakMap<object, ListsState>();
/** Core's `untracked` (`$t`): the deciding run of a call site's first item subscribes nothing. */
let untracked: (<R>(fn: () => R) => R) | undefined;
/** Development: a duplicate id already said, per list. */
let saidDup: WeakSet<object> | undefined;
/** A list the parent no longer reaches: its rows and its own hook retire. */
const orphan = (list: List) => {
  /**
   * ONCE: a second orphan would count a row-owned list out of `nested` twice, and a count driven to 0 while nested
   * lists live turns their settling off — the leak (e″) closes, silently. Unreachable today (an orphaned list's hooks and
   * rows move generation, so nothing queued runs them again), kept as the invariant.
   */
  if (list.dead) return;
  list.dead = true;
  if (ownerOf!(list.parent as unknown as RowHook) instanceof Row) nested--;
  for (let i = 0; i < list.recs.length; i++) drop(list.recs[i]);
  list.recs = [];
  list.cache.clear();
  /**
   * A disposed list may stay RECORDED (in the per-array history), so it lets go of everything else: its last
   * results (a hidden 10k list's 10 000 template results), its render's callback, its array and its part (Brian 2026-10-20:
   * "is there any risk with references getting held with the tables?").
   */
  list.values = [];
  list.fn = undefined as unknown as List['fn'];
  list.items = [];
  list.part = undefined;
  list._$g$++;
  retire!(list);
};
/** The list's result committed into `part` by the renderer's own list path; then each row learns its instance and part. */
const commitList = (list: List, part: EachPart) => {
  const outer = committing;
  committing = list.values;
  try {
    part.$p(list.values);
  } finally {
    committing = outer;
  }
  /**
   * Marked committed only once the commit SUCCEEDED: a commit that threw left the list "committed" with its
   * rows' instances stale, and the next row write patched an instance the part no longer held (`items[-1]`). Unmarked,
   * a row write wakes the parent instead, which re-renders and commits again.
   */
  list.part = part;
  list.committed = list.parent.v;
  const its = part.$i;
  const recs = list.recs;
  if (its !== undefined)
    for (let i = 0; i < recs.length; i++) {
      recs[i].inst = its[i];
      recs[i].part = part;
    }
};
/** The list's run: walk the array (subscribing the list to its shape), reuse / create / sweep rows, mark the result. */
function listRun(this: List): void {
  const all = this.all;
  this.all = false;
  if (!all && this.mapped !== this.parent.v) return orphan(this);
  const t = ++tick;
  const fn = this.fn;
  const cache = this.cache;
  const prev = this.recs;
  const n = this.items.length;
  const recs: Row[] = new Array(n);
  const values: unknown[] = new Array(n);
  let i = 0;
  let restart = false;
  const visit = (source: unknown, item: unknown) => {
    if (restart) return;
    const k = this.ident || !Object.hasOwn(source as object, 'id') ? source : (source as { id: unknown }).id;
    let rec = cache.get(k);
    if (rec !== undefined && rec.seen === t) {
      if (!this.ident) {
        /** A repeated id: identity keys from now on, and this run again from the start. */
        if (__DEV__ && !(saidDup ??= new WeakSet()).has(this)) {
          saidDup.add(this);
          console.warn(diagnostic('keyed', 'an automatic .map list', 'keyed-duplicate-key', __DEV__ && PROSE['keyed-duplicate-key'](String(k))));
        }
        this.ident = true;
        restart = true;
        return;
      }
      /** The same object twice under identity keys: a row of its own, never cached. */
      rec = makeRow(undefined, {}, item, fn, this);
    } else if (rec === undefined) {
      rec = makeRow(undefined, k, item, fn, this);
      cache.set(k, rec);
    } else if (all || rec.item !== item) {
      /** Through the row's OWN hook: what it reads subscribes the row, never the list or the parent. */
      rec.item = item;
      rec.row = fn;
      rec.h.$n(undefined, true);
    }
    rec.seen = t;
    recs[i] = rec;
    values[i++] = rec.result;
  };
  if (!walk!(this.items, visit))
    for (let j = 0; j < n; j++) {
      const item = this.items[j];
      visit(item, item);
    }
  if (restart) {
    /** Identity keys now: every row is made again by a full walk, then this run's commit decision still applies. */
    for (const rec of cache.values()) drop(rec);
    cache.clear();
    this.recs = [];
    this.all = true;
    listRun.call(this);
    if (all) return;
    if (this.committed === this.parent.v && this.part !== undefined) commitList(this, this.part);
    else this.parent.$n();
    return;
  }
  /** Last run's rows this run did not meet: swept (each drops its own subscriptions). */
  for (let j = 0; j < prev.length; j++) {
    const rec = prev[j];
    if (rec.seen !== t) {
      if (cache.get(rec.key) === rec) cache.delete(rec.key);
      drop(rec);
    }
  }
  this.recs = recs;
  (values as unknown as Record<symbol, List>)[AUTO] = this;
  this.values = values;
  if (all) return;
  /** The shape changed alone: commit where the page shows the parent's latest result, or re-render the parent. */
  if (this.committed === this.parent.v && this.part !== undefined) commitList(this, this.part);
  else this.parent.$n();
}
/** Core's `$M`: `state.todos.map(fn)` inside a render. `raw` is the array behind `proxy`; `method` the native `map`. */
const automap = (
  proxy: ArrayLike<unknown>,
  raw: unknown[],
  fn: (item: unknown) => unknown,
  parent: List['parent'],
  owner: List['owner'],
  method: (this: unknown, fn: unknown) => unknown[],
) => {
  let state = listsOf.get(parent);
  if (state === undefined) listsOf.set(parent, (state = { v: parent.v, n: 0, lists: [], occ: new Map(), byRaw: new WeakMap() }));
  else if (state.v !== parent.v) {
    state.v = parent.v;
    state.n = 0;
    state.occ.clear();
  }
  /**
   * EVERY `.map` call in a render takes its place in the order, whatever path it takes (one rule). An index or
   * non-function callback needs no memory — its arity is known at every call — so it takes the place WITHOUT writing
   * PLAIN: writing it could overwrite a live list unretired, and turn a list that slid onto this place into a plain map.
   */
  if (typeof fn !== 'function' || fn.length > 1) {
    state.n++;
    return method.call(proxy, fn);
  }
  /**
   * **Option (c): a list is found by (ARRAY, its occurrence in this run) first** (2026-10-20): a conditional `.map` before
   * another no longer slides the later one onto its list — a hidden map shifts only other maps over the SAME array. A new
   * array (a refetch) falls back to the list at this call's place in order, but only one whose own array is not mapped in
   * this run, so it never takes another site's list. A PLAIN decision is found only by its exact array (a refetched plain
   * site decides again: one untracked call).
   */
  const k = state.occ.get(raw) ?? 0;
  state.occ.set(raw, k + 1);
  const slots = state.byRaw.get(raw);
  let list: List | typeof PLAIN | undefined = slots?.[k];
  /** Dead, or already claimed by another call this run (a list serves ONE call per run): not this call's. */
  if (list !== undefined && list !== PLAIN && (list.dead || list.mapped === parent.v)) list = undefined;
  /**
   * The order fallback is for a REFETCH only — a brand-new array, with no history of its own. An array that has history is
   * a RETURNING one (a list shown again): falling back would hand it another array's list, and that array's own call would
   * then share it (measured: auto-cond, both lists rendered from one).
   */
  if (list === undefined && slots === undefined) {
    const at = state.lists[state.n];
    if (at !== undefined && at !== PLAIN && !at.dead && at.mapped !== parent.v && !state.occ.has(at.raw)) list = at;
  }
  const st = state;
  const put = (v: List | typeof PLAIN) => {
    st.lists[st.n] = v;
    let mine = st.byRaw.get(raw);
    if (mine === undefined) st.byRaw.set(raw, (mine = []));
    mine[k] = v;
    if (v !== PLAIN) v.raw = raw;
  };
  if (list === PLAIN) {
    state.n++;
    return method.call(proxy, fn);
  }
  /**
   * **A call site with a live list ALWAYS runs it — an empty array included** (2026-10-20): the empty case took the plain
   * path, so clearing a list never swept its rows — 10 000 rows stayed alive and subscribed after `state.rows = []`
   * (Chrome: 12.22 MB retained after a clear vs the earlier idiom's 4.50, `perrow.mjs`), each create ran beside the last one's
   * rows (twice the live heap: Firefox's extra major GC), and the empty call did not count its place in the parent's
   * order, so a later `.map` slid into this one's list. With no list yet, an empty or primitive array maps natively, and
   * still takes its place (an empty one stays undecided; a primitive one is PLAIN for good).
   */
  if (list === undefined || list.dead) {
    if (raw.length === 0) {
      state.n++;
      return method.call(proxy, fn);
    }
    if (raw[0] === null || typeof raw[0] !== 'object') {
      put(PLAIN);
      state.n++;
      return method.call(proxy, fn);
    }
  }
  if (list === undefined) {
    const first = untracked!(() => fn(proxy[0]));
    /**
     * A list only when the first row is a TEMPLATE result — the renderer's OWN definition, `strings !== undefined`
     * (`isTemplateResult`, renderer.ts; a DELIBERATE twin, since this module imports nothing at runtime: change both
     * together), so a hand-built `{ strings, values }` the renderer accepts is a list here too —
     * not any object: a computational map returning plain objects (`items.map((i) => ({ ...i, label }))`, a directives
     * query) became a tracked list and broke `directives-query` (2026-10-20).
     */
    if (first === null || typeof first !== 'object' || (first as { strings?: unknown }).strings === undefined) {
      put(PLAIN);
      state.n++;
      return method.call(proxy, fn);
    }
  }
  if (list === undefined || list.dead) {
    const made = new List(parent, owner);
    made.h = hook!(made, () => listRun.call(made));
    if (ownerOf!(parent as unknown as RowHook) instanceof Row) nested++;
    list = made;
  }
  put(list);
  state.n++;
  /**
   * **Owned by the parent's run** (core's `$own`): when a parent run ENDS without claiming this list — its
   * render hid it, or no longer reaches it — core disposes it (`$d`, an orphan's retirement) at once, `.map` call or not.
   */
  own!(parent, list);
  list.fn = fn;
  list.items = proxy;
  list.mapped = parent.v;
  list.all = true;
  list.h.$n(undefined, true);
  return list.values;
};
const eachValue = (part: object, value: unknown) => {
  if (value === null || typeof value !== 'object') return false;
  /** An automatic `.map` result: committed by its list, which then knows the part its rows live in. */
  if (Array.isArray(value)) {
    const list = (value as unknown as Record<symbol, List | undefined>)[AUTO];
    if (list === undefined || value === committing) return false;
    commitList(list, part as EachPart);
    return true;
  }
  return false;
};
/**
 * **`createSelector(source)` → `isSelected(key)`** (PROTOTYPE, 2026-10-20): selection that wakes
 * exactly the rows whose answer changed. `isSelected(key)` subscribes the running hook to ONE cell per key (core's store
 * kit, `$k`, on a private target), and a hook watching `source` wakes only the previous and the new key's cells when it
 * changes — so a select re-renders 2 rows, not every row that compared against `state.selected`.
 *
 * ```js
 * const isSelected = createSelector(() => state.selected);
 * state.rows.map((r) => html`<tr class=${isSelected(r.id) ? 'selected' : ''}>…</tr>`)
 * ```
 *
 * Made in a component's setup, it is that component's (its watcher retires with it); with no component being set up it
 * THROWS, as every hook does. Its watcher runs inside the write (a raw hook), so the woken rows render in the same flush.
 * Its keys are bounded: cells no row reads any more are pruned on an amortized budget (below).
 */
let kit: { track(obj: object, key: unknown): void; trigger(obj: object, key: unknown, value: unknown, prev: unknown): void; prune(obj: object): number } | undefined;
let makeHook: ((hook: { callback: () => void; priority: number }) => ((signal?: unknown, init?: boolean) => void) | undefined) | undefined;
export const createSelector = <K>(source: () => K): ((key: K) => boolean) => {
  if (kit === undefined || makeHook === undefined) throw new Error(misuse('createSelector', 'selector-not-wired', __DEV__ && PROSE['selector-not-wired']()));
  const target = {};
  const k = kit;
  let current: K | typeof target = target;
  const run = makeHook({
    callback: () => {
      const next = source();
      if (next === current) return;
      const prev = current;
      current = next;
      if (prev !== target) k.trigger(target, prev, false, true);
      k.trigger(target, next, true, false);
    },
    priority: 0,
  });
  run?.(undefined, true);
  /**
   * **Keys are bounded** (the agreed remedy): after `budget` calls the cells no row reads any more are pruned and
   * the next budget is twice what remains, plus 64 — so a prune's cost is paid for by at least as many calls, and a list
   * whose ids only increase (a feed, a log) keeps only its live keys.
   */
  let calls = 0;
  let budget = 64;
  return (key: K) => {
    k.track(target, key);
    if (++calls > budget) {
      calls = 0;
      budget = 2 * k.prune(target) + 64;
    }
    return current === key;
  };
};

/**
 * Wire it: `wire([renderer, eachList])`. A CONNECTOR (a function `wire` hands the registry): core's registry carries the
 * hook machinery (`$q`, `$z`) and the raw walk (`$w`); automatic `.map` results are recognized on the renderer's `'value'` insert.
 */
export const eachList = (registry: { $q?: unknown; $qb?: unknown; $zh?: unknown; $ow?: unknown; $own?: unknown; $so?: unknown; $z?: unknown; $w?: unknown; $M?: unknown; $t?: unknown; $k?: unknown; $s?: unknown }, w: (item: unknown) => void) => {
  hook = registry.$q as typeof hook;
  bareHook = registry.$qb as typeof bareHook;
  retireHook = registry.$zh as typeof retireHook;
  ownerOf = registry.$ow as typeof ownerOf;
  own = registry.$own as typeof own;
  settle = registry.$so as typeof settle;
  /** Core's array handler asks `$M` for a store array's `.map` inside a render: automatic lists. */
  (registry as { $M?: unknown }).$M = automap;
  retire = registry.$z as typeof retire;
  untracked = registry.$t as typeof untracked;
  kit = registry.$k as typeof kit;
  makeHook = (registry.$s as unknown[] | undefined)?.[2] as typeof makeHook;
  walk = registry.$w as typeof walk;
  w({ on: 'value', fn: eachValue, priority: 50 });
};
