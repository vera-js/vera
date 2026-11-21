/**
 * **The roving group's move, as a pure function**: which item a key moves to, from the item count, the current index,
 * the key, the group's axis and which items are reachable. It reads no DOM, so its rows and its fuzz need none.
 */
import type { RovingAxis } from './types.js';

/** Home's and End's steps: not a direction but an end. */
const FIRST = 2;
const LAST = -2;

/** Which way `key` moves on `axis`: 1 or -1, FIRST or LAST, or null for a key this group does not handle. */
const stepOf = (key: string, { orientation, rtl }: RovingAxis): number | null => {
  if (key === 'Home') return FIRST;
  if (key === 'End') return LAST;
  const horizontal = orientation !== 'vertical';
  const vertical = orientation !== 'horizontal';
  if (horizontal && key === 'ArrowRight') return rtl ? -1 : 1;
  if (horizontal && key === 'ArrowLeft') return rtl ? 1 : -1;
  if (vertical && key === 'ArrowDown') return 1;
  if (vertical && key === 'ArrowUp') return -1;
  return null;
};

/**
 * The first reachable index after `from` going `step`, wrapping at most once when `wrap` is set: at most `count` items
 * are looked at, so a group with one reachable item, or none, ends the walk. -1 when no other item is reachable.
 */
const scan = (count: number, from: number, step: number, wrap: boolean, reachable: (i: number) => boolean): number => {
  for (let n = 1; n <= count; n++) {
    let i = from + step * n;
    if (i < 0 || i >= count) {
      if (!wrap) return -1;
      i = ((i % count) + count) % count;
    }
    if (i === from) return -1;
    if (reachable(i)) return i;
  }
  return -1;
};

/**
 * @param count How many items the group has now
 * @param index The focused item's index; -1, or any index outside the items, when it is gone (removed, or not an item)
 * @param key `KeyboardEvent.key`, with no modifier held (the hook never calls this for a modified key)
 * @param axis Which arrows move, whether the group is right to left, and whether it wraps
 * @param reachable Whether item `i` can take focus, read at the call (an item disabled since the last key is skipped)
 * @returns One of four answers:
 *   - `null`: not this group's key. The caller does nothing and does not `preventDefault`.
 *   - `index` itself: handled, with nowhere to go (an end without `wrap`, or the only reachable item).
 *   - any other index: the item to move to. With the focused item gone, an arrow moves to the FIRST reachable item
 *     whichever way it points (one rule), and Home and End to the first and last.
 *   - `-1`: handled, and no item is reachable at all.
 */
export const nextIndex = (count: number, index: number, key: string, axis: RovingAxis, reachable: (i: number) => boolean): number | null => {
  const step = stepOf(key, axis);
  if (step === null) return null;
  if (step === FIRST) return scan(count, -1, 1, false, reachable);
  if (step === LAST) return scan(count, count, -1, false, reachable);
  if (index < 0 || index >= count) return scan(count, -1, 1, false, reachable);
  const found = scan(count, index, step, axis.wrap, reachable);
  return found === -1 ? (reachable(index) ? index : -1) : found;
};
