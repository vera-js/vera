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
  /**
   * Said once, where it is nearly free: the general algorithm already walks every key, and a list
   * whose keys never move never reaches here at all. A duplicate key is a mistake that behaves
   * *correctly* in the common case and arbitrarily in the rest, which is the shape of bug that
   * survives a test suite.
   */
  if (__DEV__ && new Set(newKeys).size !== count) {
    const seen = new Set<unknown>();
    const repeated = newKeys.filter((key) => (seen.has(key) ? true : (seen.add(key), false)));
    console.warn(
      `[vera] keyed: the key ${String(repeated[0])} is used by more than one item in this list. ` +
        `A key identifies one item, so which of them keeps the existing DOM is not defined — ` +
        `the list still renders, but nothing about which node ends up where can be relied on.`
    );
  }
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
        /**
         * **`oldItems[oldIndex]` can be null, and reading it crashed the render.** The map holds one
         * index per key, so a list where a key appears twice finds, for the second one, the slot the
         * first already consumed and nulled. `part.$m(null, …)` then read `_element` of null and took
         * the whole render down with a `TypeError` naming the renderer's internals rather than
         * anything the caller wrote.
         *
         * Duplicate keys are documented as undefined behaviour and stay that way — which of the two
         * keeps the existing node is not specified. Undefined must still mean *a list*, though, not
         * an exception from three frames inside a private algorithm: the shapes that crash are
         * particular (a duplicate **and** a reorder **and** a new key, found by fuzzing over a
         * four-key alphabet), so this passes in development and takes the page down later.
         *
         * Two ways a slot can already be spoken for, and both have to be checked. The map nulls what
         * it consumes, so `oldItems[oldIndex] === null` catches one. The other is invisible: the map
         * is built once, and the head/tail branches above consume items by *moving the pointers*
         * without nulling anything — so an index that was live when the map was built can now sit
         * outside `[oldHead, oldTail]`. With unique keys that is unreachable, because a key is looked
         * up at most once; with a repeated key it hands the same item to two positions, and the list
         * then renders one item short of what it holds. Checking only for null fixed the crash and
         * left that, which is the worse of the two — nothing throws and the page is quietly wrong.
         *
         * Treating either as "not found" gives the second occurrence a fresh item, which is what the
         * branch below already does for a key that never existed.
         */
        const reusable =
          oldIndex === undefined || oldIndex < oldHead || oldIndex > oldTail
            ? null
            : oldItems[oldIndex];
        if (reusable === null) {
          newItems[newHead] = part.$c(newValues[newHead], parent, part.$f(oldItems[oldHead]!));
        } else {
          const item = reusable;
          part.$m(item, part.$f(oldItems[oldHead]!), parent);
          part.$u(item, newValues[newHead]);
          newItems[newHead] = item;
          oldItems[oldIndex!] = null;
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
 * **Undefined means the list is arbitrary, not that the render fails.** With a repeated key, which
 * item keeps the existing node is unspecified; the render still completes and the DOM still holds
 * what the list holds. Development warns, once per render.
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
