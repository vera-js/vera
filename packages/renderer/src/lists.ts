import type { Item, ValueOps } from './renderer.js';

/**
 * `@verajs/renderer/lists` — rendering an array at a child position.
 *
 * ```js
 * import { wire } from '@verajs/core';
 * import { domRender } from '@verajs/renderer';
 * import { lists } from '@verajs/renderer/lists';
 *
 * wire([domRender, lists]);
 * ```
 *
 * Index mode and keyed head/tail reconciliation, registered as a `'value'` handler rather than
 * built into the renderer. Two reasons it is a module and not a branch: list rendering has genuine
 * **strategies** — index, keyed, windowed, virtualized — so an app may reasonably want a different
 * one, and until something claims arrays the renderer carries none of this.
 *
 * A handler is handed the operations it needs (`ops`), the way `'proxy-handler'` is handed
 * `addCallback` and `runCallbacks`. It never reaches into a part: `part` is opaque here and is only
 * ever passed back.
 *
 * Registered at 50, the convention for a default. A virtualizer wanting to claim arrays first
 * registers below it — `wire([domRender, lists, { on: 'value', fn: virtualize, priority: 40 }])`.
 */

const commit = (part: object, values: unknown[], ops: ValueOps) => {
  ops.claim(part);

  const count = values.length;
  if (count === 0) {
    if (ops.items(part).length) ops.reset(part);
    return;
  }

  const isKeyed = values[0] != null && (values[0] as { key?: unknown }).key !== undefined;
  if (isKeyed !== ops.isKeyed(part) && ops.items(part).length) ops.reset(part);
  ops.setKeyed(part, isKeyed);

  const items = ops.items(part);
  const parent = ops.parent(part);

  if (items.length === 0) {
    /** Initial fill builds off-document and lands in one insert. */
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < count; i++) items.push(ops.create(part, values[i], fragment, null));
    ops.insert(part, fragment);
    return;
  }

  if (!isKeyed) {
    // index mode: update in place, grow at the end, shrink from the end
    const shared = items.length < count ? items.length : count;
    for (let i = 0; i < shared; i++) ops.update(part, items[i], values[i]);
    if (count > items.length) {
      const fragment = document.createDocumentFragment();
      for (let i = items.length; i < count; i++) items.push(ops.create(part, values[i], fragment, null));
      ops.insert(part, fragment);
    } else if (count < items.length) {
      const stop = ops.afterNode(items[items.length - 1]);
      let node: Node | null = ops.firstNode(items[count]);
      while (node !== stop) {
        const next: Node | null = node!.nextSibling;
        parent.removeChild(node!);
        node = next;
      }
      items.length = count;
    }
    return;
  }

  /**
   * Zero-allocation fast path for the dominant case: same length, same key order — a pure in-place
   * update (a selection change, a field edit). No key array, no output array, no null checks. Falls
   * through to the full algorithm on the first mismatch; the items already updated re-verify there
   * as cheap no-op compares.
   */
  if (items.length === count) {
    let i = 0;
    while (i < count && ops.key(items[i]) === (values[i] as { key?: unknown }).key) {
      ops.update(part, items[i], values[i]);
      i++;
    }
    if (i === count) return;
  }

  /**
   * Keyed reconciliation — the standard head/tail algorithm (as in lit's `repeat` and Vue): skip
   * matching prefixes and suffixes, detect the two swap shapes directly, and fall back to key maps
   * for arbitrary moves, removals and insertions.
   */
  const oldItems: (Item | null)[] = items;
  const newKeys: unknown[] = new Array(count);
  for (let i = 0; i < count; i++) newKeys[i] = (values[i] as { key?: unknown }).key;
  const newItems: Item[] = new Array(count);
  let oldHead = 0;
  let oldTail = oldItems.length - 1;
  let newHead = 0;
  let newTail = count - 1;
  let newKeyToIndex: Map<unknown, number> | undefined;
  let oldKeyToIndex: Map<unknown, number> | undefined;
  const refAt = (i: number): Node | null =>
    i < count && newItems[i] !== undefined ? ops.firstNode(newItems[i]) : ops.end(part);

  while (oldHead <= oldTail && newHead <= newTail) {
    if (oldItems[oldHead] === null) oldHead++;
    else if (oldItems[oldTail] === null) oldTail--;
    else if (ops.key(oldItems[oldHead]!) === newKeys[newHead]) {
      ops.update(part, (newItems[newHead] = oldItems[oldHead]!), values[newHead]);
      oldHead++;
      newHead++;
    } else if (ops.key(oldItems[oldTail]!) === newKeys[newTail]) {
      ops.update(part, (newItems[newTail] = oldItems[oldTail]!), values[newTail]);
      oldTail--;
      newTail--;
    } else if (ops.key(oldItems[oldHead]!) === newKeys[newTail]) {
      const item = oldItems[oldHead]!;
      ops.move(part, item, refAt(newTail + 1));
      ops.update(part, item, values[newTail]);
      newItems[newTail] = item;
      oldHead++;
      newTail--;
    } else if (ops.key(oldItems[oldTail]!) === newKeys[newHead]) {
      const item = oldItems[oldTail]!;
      ops.move(part, item, ops.firstNode(oldItems[oldHead]!));
      ops.update(part, item, values[newHead]);
      newItems[newHead] = item;
      oldTail--;
      newHead++;
    } else {
      if (newKeyToIndex === undefined) {
        newKeyToIndex = new Map();
        for (let i = newHead; i <= newTail; i++) newKeyToIndex.set(newKeys[i], i);
        oldKeyToIndex = new Map();
        for (let i = oldHead; i <= oldTail; i++) {
          if (oldItems[i] !== null) oldKeyToIndex.set(ops.key(oldItems[i]!), i);
        }
      }
      if (!newKeyToIndex.has(ops.key(oldItems[oldHead]!))) {
        ops.drop(part, oldItems[oldHead]!);
        oldHead++;
      } else if (!newKeyToIndex.has(ops.key(oldItems[oldTail]!))) {
        ops.drop(part, oldItems[oldTail]!);
        oldTail--;
      } else {
        const oldIndex = oldKeyToIndex!.get(newKeys[newHead]);
        if (oldIndex === undefined) {
          newItems[newHead] = ops.create(part, values[newHead], parent, ops.firstNode(oldItems[oldHead]!));
        } else {
          const item = oldItems[oldIndex]!;
          ops.move(part, item, ops.firstNode(oldItems[oldHead]!));
          ops.update(part, item, values[newHead]);
          newItems[newHead] = item;
          oldItems[oldIndex] = null;
        }
        newHead++;
      }
    }
  }
  while (newHead <= newTail) {
    newItems[newHead] = ops.create(part, values[newHead], parent, refAt(newTail + 1));
    newHead++;
  }
  while (oldHead <= oldTail) {
    const item = oldItems[oldHead++];
    if (item !== null) ops.drop(part, item);
  }
  ops.setItems(part, newItems);
};

/** Wire it: `wire([domRender, lists])`. */
export const lists = {
  name: '@verajs/renderer/lists',
  on: 'value' as const,
  priority: 50,
  fn: ((part: object, value: unknown, ops: ValueOps) => {
    if (Array.isArray(value)) {
      commit(part, value, ops);
      return true;
    }
    if (value !== null && typeof (value as Iterable<unknown>)[Symbol.iterator] === 'function') {
      commit(part, [...(value as Iterable<unknown>)], ops);
      return true;
    }
    return false;
  }) as never,
};
