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

  /** The dominant case — same keys, same order (a selection, a field edit): update in place, allocate nothing. */
  if (items.length === count) {
    let i = 0;
    while (i < count && items[i].$k === (values[i] as KeyedResult).key) {
      items[i] = part.$u(items[i], values[i]);
      i++;
    }
    if (i === count) return items;
  }

  const oldItems: (Item | null)[] = items;
  const newKeys: unknown[] = new Array(count);
  for (let i = 0; i < count; i++) newKeys[i] = (values[i] as KeyedResult).key;
  const newItems: Item[] = new Array(count);
  let oldHead = 0;
  let oldTail = oldItems.length - 1;
  let newHead = 0;
  let newTail = count - 1;
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
