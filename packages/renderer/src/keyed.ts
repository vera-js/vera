import type { Item, KeyedResult, ListStrategy } from './renderer.js';

/**
 * Keyed list reconciliation, as its own entry.
 *
 * **This module imports nothing.** Every other renderer entry inlines `./renderer.js` and carries
 * its own template cache, so a module that imported one of them would be wrong for the others —
 * `hydrate` in particular. Like `spread`, this one talks to whatever renderer is present through a
 * mangling-exempt protocol, which is what makes it additive rather than a substitute.
 *
 * It also does not register. `keyed()` stamps `$r` onto the result it marks, so the algorithm
 * travels with the values that need it: importing the marker is the whole installation, and a list
 * always names the strategy that understands it. Two strategies therefore cannot disagree — there
 * is nothing to disagree about, because the decision is per value rather than per registry.
 */

/**
 * The standard head/tail algorithm (as in lit's `repeat` and Vue): skip matching prefixes and
 * suffixes, detect the two swap shapes directly, and fall back to key maps for arbitrary moves,
 * removals and insertions.
 *
 * Everything before reconciliation — the mode switch, the empty list, the initial fill — has
 * already happened in the renderer and is passed in, so this function only ever runs against a
 * non-empty list that is already keyed.
 */
const reconcile: ListStrategy = (part, newValues, items, parent, end) => {
  const count = newValues.length;

  /**
   * Zero-allocation fast path for the dominant case: same length, same key order — a pure in-place
   * update (a selection change, a field edit). No key array, no output array, no null checks. Falls
   * through to the full algorithm on the first mismatch; the items already updated re-verify there
   * as cheap no-op compares.
   */
  if (items.length === count) {
    let i = 0;
    while (i < count && items[i].$k === (newValues[i] as KeyedResult).key) {
      part.$u(items[i], newValues[i]);
      i++;
    }
    if (i === count) return items;
  }

  const oldItems: (Item | null)[] = items;
  const newKeys: unknown[] = new Array(count);
  for (let i = 0; i < count; i++) newKeys[i] = (newValues[i] as KeyedResult).key;
  const newItems: Item[] = new Array(count);
  let oldHead = 0;
  let oldTail = oldItems.length - 1;
  let newHead = 0;
  let newTail = count - 1;
  let newKeyToIndex: Map<unknown, number> | undefined;
  let oldKeyToIndex: Map<unknown, number> | undefined;
  const refAt = (i: number): Node | null =>
    i < count && newItems[i] !== undefined ? part.$f(newItems[i]) : end;

  while (oldHead <= oldTail && newHead <= newTail) {
    if (oldItems[oldHead] === null) oldHead++;
    else if (oldItems[oldTail] === null) oldTail--;
    else if (oldItems[oldHead]!.$k === newKeys[newHead]) {
      part.$u((newItems[newHead] = oldItems[oldHead]!), newValues[newHead]);
      oldHead++;
      newHead++;
    } else if (oldItems[oldTail]!.$k === newKeys[newTail]) {
      part.$u((newItems[newTail] = oldItems[oldTail]!), newValues[newTail]);
      oldTail--;
      newTail--;
    } else if (oldItems[oldHead]!.$k === newKeys[newTail]) {
      const item = oldItems[oldHead]!;
      part.$m(item, refAt(newTail + 1), parent);
      part.$u(item, newValues[newTail]);
      newItems[newTail] = item;
      oldHead++;
      newTail--;
    } else if (oldItems[oldTail]!.$k === newKeys[newHead]) {
      const item = oldItems[oldTail]!;
      part.$m(item, part.$f(oldItems[oldHead]!), parent);
      part.$u(item, newValues[newHead]);
      newItems[newHead] = item;
      oldTail--;
      newHead++;
    } else {
      if (newKeyToIndex === undefined) {
        newKeyToIndex = new Map();
        for (let i = newHead; i <= newTail; i++) newKeyToIndex.set(newKeys[i], i);
        oldKeyToIndex = new Map();
        for (let i = oldHead; i <= oldTail; i++) {
          if (oldItems[i] !== null) oldKeyToIndex.set(oldItems[i]!.$k, i);
        }
      }
      if (!newKeyToIndex.has(oldItems[oldHead]!.$k)) {
        part.$d(oldItems[oldHead]!);
        oldHead++;
      } else if (!newKeyToIndex.has(oldItems[oldTail]!.$k)) {
        part.$d(oldItems[oldTail]!);
        oldTail--;
      } else {
        const oldIndex = oldKeyToIndex!.get(newKeys[newHead]);
        if (oldIndex === undefined) {
          newItems[newHead] = part.$c(newValues[newHead], parent, part.$f(oldItems[oldHead]!));
        } else {
          const item = oldItems[oldIndex]!;
          part.$m(item, part.$f(oldItems[oldHead]!), parent);
          part.$u(item, newValues[newHead]);
          newItems[newHead] = item;
          oldItems[oldIndex] = null;
        }
        newHead++;
      }
    }
  }
  while (newHead <= newTail) {
    newItems[newHead] = part.$c(newValues[newHead], parent, refAt(newTail + 1));
    newHead++;
  }
  while (oldHead <= oldTail) {
    const item = oldItems[oldHead++];
    if (item !== null) part.$d(item);
  }
  return newItems;
};

/**
 * Marks a template result with a stable key so list reconciliation moves it instead of rewriting
 * it. Key all items in a list or none — mixing is undefined behaviour, as are duplicate keys.
 *
 * ```js
 * import { keyed } from '@verajs/renderer/keyed';
 * rows.map((r) => keyed(r.id, html`<tr>...</tr>`))
 * ```
 */
export const keyed = <T>(key: unknown, result: T): T => {
  /**
   * Two arguments, and the second is the one that goes missing — `keyed(row.id)` instead of
   * `keyed(row.id, html\`…\`)`. It failed with `Cannot set properties of undefined (setting 'key')`,
   * which names this function's internals and not the call.
   */
  if (__DEV__ && (result === null || typeof result !== 'object'))
    throw new TypeError(
      `keyed: expected a template as the second argument and received ${String(result)}. ` +
        `It marks a template with a key — \`keyed(row.id, html\`<li>…</li>\`)\`.`
    );
  (result as KeyedResult).key = key;
  (result as KeyedResult).$r = reconcile;
  return result;
};
