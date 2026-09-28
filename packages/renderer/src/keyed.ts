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

  /**
   * The unchanged run at each end — matched without allocating. When what remains between them is only
   * removals (a row deleted) or only insertions (rows appended, prepended, inserted), it is settled here
   * with one `splice`; a same-order update is the case where nothing remains at all.
   */
  let start = 0;
  let oldEnd = items.length - 1;
  let newEnd = count - 1;
  while (start <= oldEnd && start <= newEnd && items[start].$k === (values[start] as KeyedResult).key) {
    items[start] = part.$u(items[start], values[start]);
    start++;
  }
  while (oldEnd >= start && newEnd >= start && items[oldEnd].$k === (values[newEnd] as KeyedResult).key) {
    items[oldEnd] = part.$u(items[oldEnd], values[newEnd]);
    oldEnd--;
    newEnd--;
  }
  if (start > newEnd) {
    for (let i = start; i <= oldEnd; i++) part.$d(items[i]);
    if (start <= oldEnd) items.splice(start, oldEnd - start + 1);
    return items;
  }
  if (start > oldEnd) {
    const ref = start < items.length ? part.$f(items[start]) : end;
    const added: Item[] = new Array(newEnd - start + 1);
    for (let i = start; i <= newEnd; i++) added[i - start] = part.$c(values[i], parent, ref);
    items.splice(start, 0, ...added);
    return items;
  }

  /** A genuine reorder: the full algorithm, picking up where the ends left off. */
  const oldItems: (Item | null)[] = items;
  const newKeys: unknown[] = new Array(count);
  for (let i = start; i <= newEnd; i++) newKeys[i] = (values[i] as KeyedResult).key;
  const newItems: Item[] = new Array(count);
  for (let i = 0; i < start; i++) newItems[i] = items[i];
  for (let i = newEnd + 1, j = oldEnd + 1; i < count; i++, j++) newItems[i] = items[j];
  let oldHead = start;
  let oldTail = oldEnd;
  let newHead = start;
  let newTail = newEnd;
  let newKeyToIndex: Map<unknown, number> | undefined;
  let oldKeyToIndex: Map<unknown, number> | undefined;
  const refAt = (i: number): Node | null => (i < count && newItems[i] !== undefined ? part.$f(newItems[i]) : end);

  /** Two-ended: matching heads and tails cost a compare; a key map is built only when both ends miss. */
  while (oldHead <= oldTail && newHead <= newTail) {
    if (oldItems[oldHead] === null) oldHead++;
    else if (oldItems[oldTail] === null) oldTail--;
    else if (oldItems[oldHead]!.$k === newKeys[newHead]) {
      newItems[newHead] = part.$u(oldItems[oldHead]!, values[newHead]);
      oldHead++;
      newHead++;
    } else if (oldItems[oldTail]!.$k === newKeys[newTail]) {
      newItems[newTail] = part.$u(oldItems[oldTail]!, values[newTail]);
      oldTail--;
      newTail--;
    } else if (oldItems[oldHead]!.$k === newKeys[newTail]) {
      const item = oldItems[oldHead]!;
      part.$m(item, refAt(newTail + 1), parent);
      newItems[newTail] = part.$u(item, values[newTail]);
      oldHead++;
      newTail--;
    } else if (oldItems[oldTail]!.$k === newKeys[newHead]) {
      const item = oldItems[oldTail]!;
      part.$m(item, part.$f(oldItems[oldHead]!), parent);
      newItems[newHead] = part.$u(item, values[newHead]);
      oldTail--;
      newHead++;
    } else {
      if (newKeyToIndex === undefined) {
        newKeyToIndex = new Map();
        for (let i = newHead; i <= newTail; i++) newKeyToIndex.set(newKeys[i], i);
        oldKeyToIndex = new Map();
        for (let i = oldHead; i <= oldTail; i++) if (oldItems[i] !== null) oldKeyToIndex.set(oldItems[i]!.$k, i);
      }
      if (!newKeyToIndex.has(oldItems[oldHead]!.$k)) {
        part.$d(oldItems[oldHead]!);
        oldHead++;
      } else if (!newKeyToIndex.has(oldItems[oldTail]!.$k)) {
        part.$d(oldItems[oldTail]!);
        oldTail--;
      } else {
        /**
         * A slot the map points at may already be spoken for when a key repeats: nulled by an earlier
         * reuse, or consumed by the head/tail branches (which move pointers without nulling). Either
         * is treated as "not found" and gets a fresh item — duplicate keys are undefined behavior,
         * but undefined must still mean a list, never a throw or a row rendered twice.
         */
        const oldIndex = oldKeyToIndex!.get(newKeys[newHead]);
        const reusable = oldIndex === undefined || oldIndex < oldHead || oldIndex > oldTail ? null : oldItems[oldIndex];
        if (reusable === null) newItems[newHead] = part.$c(values[newHead], parent, part.$f(oldItems[oldHead]!));
        else {
          part.$m(reusable, part.$f(oldItems[oldHead]!), parent);
          newItems[newHead] = part.$u(reusable, values[newHead]);
          oldItems[oldIndex!] = null;
        }
        newHead++;
      }
    }
  }
  /** New items fill before one fixed reference, straight into the parent — the loop only fills slots below it. */
  if (newHead <= newTail) {
    const ref = refAt(newTail + 1);
    for (; newHead <= newTail; newHead++) newItems[newHead] = part.$c(values[newHead], parent, ref);
  }
  while (oldHead <= oldTail) {
    const item = oldItems[oldHead++];
    if (item !== null) part.$d(item);
  }
  return newItems;
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
