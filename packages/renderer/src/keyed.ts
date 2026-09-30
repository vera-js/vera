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
  while (start <= oldEnd && start <= newEnd && items[start].$k === key(start)) {
    items[start] = part.$u(items[start], values[start]);
    start++;
  }
  while (start <= oldEnd && start <= newEnd && items[oldEnd].$k === key(newEnd)) {
    items[oldEnd] = part.$u(items[oldEnd], values[newEnd]);
    oldEnd--;
    newEnd--;
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
  (result as KeyedResult).key = key;
  (result as KeyedResult).$r = reconcile;
  return result;
};
