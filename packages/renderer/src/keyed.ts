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
  /** A row whose value is the result committed last time (an `each` row that did not re-render) is not even asked. */
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
 * **PROBE (P1, 2026-10-18): `each(items, key, row)`, a keyed list whose rows track themselves** (DESIGN-FINE-GRAINED).
 * Built from what exists: the renderer's `'value'` insert hands this module the list part; core's hook machinery
 * (`$q` queued hook with an explicit owner, `$z` retire) gives each row its own subscriber; the list part's existing
 * reconcile and the marked identity skip do the walk and the moves. A row's result is reused (the same object) while its
 * item is `===` and nothing it read changed; a write a row read wakes exactly that row, which re-commits itself in
 * place through `part.$u`. `row` must depend only on its item and REACTIVE reads (a plain value closed over from the
 * parent's render goes stale: documented, React.memo's pitfall).
 */
type EachValue = { _$each$: 1; items: ArrayLike<unknown>; key: (item: unknown) => unknown; row: (item: unknown) => unknown };
type Owner = { _$g$: number; _$x$: boolean; _$h$?: unknown[]; localName: string; readonly isConnected: boolean; readonly ownerDocument: Document };
/** The row's hook, as core's `$q` hands it back: the record itself, run through its `$n` (a `$`-name: survives mangling). */
type RowHook = { $n(signal?: unknown, init?: boolean): void };
type EachPart = { $p(value: unknown): void; $u(item: Item, value: unknown): Item; $i?: Item[]; $E?: Map<unknown, Row>; $L?: Row[] };
export const each = <T>(items: ArrayLike<T>, key: (item: T) => unknown, row: (item: T) => unknown): unknown =>
  ({ _$each$: 1, items, key, row }) as EachValue;

/** Core's retire (`$z`), handed over by `eachList` when it is wired: what releases a row's subscriptions. */
let retire: ((owner: Owner) => void) | undefined;
/** Core's raw walk of a store array (`$w`), when core is wired; otherwise the list walks itself. */
let walk: ((list: unknown, visit: (raw: unknown, item: unknown) => void) => boolean) | undefined;
/** The render counter: a row stamped with this render's `t` was met in it; one not met is swept (`eachValue`). */
let tick = 0;

/**
 * A row's template result, ready for the list part: its `key` (what reconcile matches on), `$r` (the keyed strategy, so
 * the part reconciles by key) and `_$same$` (opts the result into the identity skip: the renderer may do nothing when
 * the SAME result object comes back, which `each` guarantees for a row that did not re-render).
 */
const stamp = (rec: Row) => {
  const r = rec.row(rec.item) as KeyedResult & { _$same$?: number };
  r.key = rec.key;
  r.$r = reconcile;
  r._$same$ = 1;
  return r;
};
/**
 * **A row IS its hook** (PROTOTYPE probe/cells-auto, 2026-10-20, Brian: make the row tracker cost ~nothing): a subclass of
 * core's hook class (`$hc`) that owns itself, so one row is ONE object. It was three plus a closure: a row record (the
 * owner), core's hook, the owner's one-element hook list, and the run closure. As the hook, its run is `rowRun` (shared,
 * `this` is the row). As its own owner it carries what core reads of an owner: `_$g$` its generation (bumped by `drop`,
 * which retires it), `_$x$` / `localName`, `_$h$` (never set: core retires a self-owned hook directly), `isConnected`
 * (core skips a disconnected owner's writes; the row is connected while its rendered node is) and `ownerDocument` (the
 * scheduler uses the element's own window). As the record: `part` its list part, `key` its key, `item` / `row` what it
 * renders from, `result` its last template result, `inst` the instance that result was committed into, `seen` the render
 * that last met it. The class is made when `eachList` is wired, since its base comes from core's registry. It must write
 * only `$`-named fields of core's class, and its OWN fields need names the production mangler can never generate (no
 * one- or two-character names: core's mangled hook fields are `t`, `k`, `R`, `$`…, and a row's `k` / `t` overwrote the
 * hook's creation sequence and flush stamp — measured, 2026-10-20). Hence `part`, `key`, `seen`.
 */
type Row = Owner & RowHook & {
  part: EachPart;
  result: KeyedResult | null;
  inst: Item | undefined;
  key: unknown;
  item: unknown;
  row: (item: unknown) => unknown;
  seen: number;
};
let Row: (new (p: EachPart, k: unknown, item: unknown, row: (item: unknown) => unknown, t: number) => Row) | undefined;
/**
 * The row's run: a write the row's render read wakes exactly this row. It re-stamps and commits its new result into its
 * OWN instance in place (`part.$u`); if the instance had to be replaced (the row's shape changed), the list part's item
 * array is patched to point at the new one.
 */
function rowRun(this: Row) {
  const r = stamp(this);
  const was = this.result;
  this.result = r;
  if (was !== null && this.inst !== undefined) {
    const part = this.part;
    const out = part.$u(this.inst, r);
    if (out !== this.inst) {
      const items = part.$i!;
      items[items.indexOf(this.inst)] = out;
      this.inst = out;
    }
  }
}
const makeRow = (part: EachPart, k: unknown, item: unknown, row: (item: unknown) => unknown): Row => {
  const rec = new Row!(part, k, item, row, tick);
  /** `init`: a hook's first run is immediate (a queued hook's write-time run would only enqueue it). */
  rec.$n(undefined, true);
  return rec;
};
/** A row that left the list: its generation moves on (it goes inert) and core retires it (a self-owned hook: directly). */
const drop = (rec: Row) => {
  rec._$g$++;
  retire!(rec);
};
const eachValue = (part: object, value: unknown) => {
  if (value === null || typeof value !== 'object' || (value as EachValue)._$each$ !== 1) return false;
  const p = part as EachPart;
  const { items, key, row } = value as EachValue;
  /** Key → row record, per list part (`$E`): how a row is found again when it moved or the list was replaced. */
  const cache = (p.$E ??= new Map());
  const t = ++tick;
  const n = items.length;
  const recs: Row[] = new Array(n);
  const values: unknown[] = new Array(n);
  let made = false;
  let i = 0;
  /**
   * **Last render's rows, in order** (`$L`): an item still where it was, or where it was shifted by the change in length
   * (everything after one insert or removal) and the SAME item (`===`, the store hands back one proxy per object), is
   * its own row again with no key read and no lookup. Only the slots near
   * a change go through the key.
   */
  const prev = p.$L;
  const shift = prev === undefined ? 0 : prev.length - n;
  /**
   * `source` is what the key is read from: the RAW slot when the list is a store array (`walk`, core's `$w`), so a
   * key read is a plain read, untracked; `item` is what the row renders and tracks through.
   */
  const visit = (source: unknown, item: unknown) => {
    let rec: Row | undefined;
    if (prev !== undefined) {
      const at = prev[i];
      if (at !== undefined && at.item === item && at.seen !== t) rec = at;
      else {
        const moved = prev[i + shift];
        if (moved !== undefined && moved.item === item && moved.seen !== t) rec = moved;
      }
    }
    if (rec === undefined) {
      const k = key(source);
      rec = cache.get(k);
      if (rec === undefined) {
        rec = makeRow(p, k, item, row);
        cache.set(k, rec);
        made = true;
      } else if (rec.item !== item) {
        /** Through the row's OWN hook, so what the new item's render reads subscribes the row, not the list's render. */
        rec.item = item;
        rec.row = row;
        rec.$n(undefined, true);
      }
    }
    rec.seen = t;
    recs[i] = rec;
    values[i++] = rec.result;
  };
  if (walk === undefined || !walk(items, visit))
    for (let j = 0; j < n; j++) {
      const item = items[j];
      visit(item, item);
    }
  /** The rows not met this render are last render's that were not visited: swept from that array, not the whole map. */
  if (prev !== undefined && (made || cache.size !== n))
    for (let j = 0; j < prev.length; j++) {
      const rec = prev[j];
      if (rec.seen !== t) {
        cache.delete(rec.key);
        drop(rec);
      }
    }
  p.$L = recs;
  p.$p(values);
  /** After reconcile, each row learns the instance it was committed into, which its own hook updates in place. */
  const its = p.$i;
  if (its !== undefined) for (let i = 0; i < n; i++) if (recs[i].inst !== its[i]) recs[i].inst = its[i];
  return true;
};
/**
 * Wire it: `wire([renderer, eachList])`. A CONNECTOR (a function `wire` hands the registry): core's registry carries the
 * hook machinery (`$q`, `$z`) and the raw walk (`$w`); `each` values are recognized on the renderer's `'value'` insert.
 */
export const eachList = (registry: { $hc?: unknown; $z?: unknown; $w?: unknown }, w: (item: unknown) => void) => {
  /** `super(null, …)`: the row owns itself. 50 and 1 are core's RENDER_PRIORITY and MODE_QUEUED (a row renders, queued). */
  const Base = registry.$hc as new (owner: null, callback: () => void, priority: number, mode: number) => object;
  Row ??= class extends Base {
    declare _$g$: number;
    declare _$x$: boolean;
    declare _$h$: unknown[] | undefined;
    declare localName: string;
    declare part: EachPart;
    declare result: KeyedResult | null;
    declare inst: Item | undefined;
    declare key: unknown;
    declare item: unknown;
    declare row: (item: unknown) => unknown;
    declare seen: number;
    constructor(p: EachPart, k: unknown, item: unknown, row: (item: unknown) => unknown, t: number) {
      super(null, rowRun, 50, 1);
      /** Core sets its own (mangled) `_g` to 1 for a self-owned hook; only `$`-named fields cross a bundle. */
      this._$g$ = 1;
      this._$x$ = false;
      this._$h$ = undefined;
      this.localName = 'each-row';
      this.part = p;
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
  } as unknown as typeof Row;
  retire = registry.$z as typeof retire;
  walk = registry.$w as typeof walk;
  w({ on: 'value', fn: eachValue, priority: 50 });
};
