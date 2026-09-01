
/**
 * Get an object's type.
 *
 * @param  obj The object
 * @return The type
 */
export const getType = (obj: unknown) => Object.prototype.toString.call(obj).slice(8, -1).toLowerCase();

/**
 * Whether an item is a set or map
 *
 * @param item Item to check
 */
const KEYED_COLLECTIONS = ['map', 'set', 'weakmap', 'weakset'];

/**
 * Weak collections need their per-key dependencies stored weakly, or tracking `weakMap.get(obj)`
 * holds `obj` and defeats the whole point of the type. Checked by type string rather than
 * `instanceof`, which fails across realms (iframes, `vm`).
 */
export const isWeakCollection = (item: unknown) => getType(item)[0] === 'w';
export const isSetOrMap = <T>(item: T) => KEYED_COLLECTIONS.includes(getType(item));

/**
 * Remove a trailing slash from an url if its not root url (`/`).
 *
 * @param str String to remove trailing slash from
 */
export const stripTrailingSlash = (str: string) => (str !== '/' && str.endsWith('/') ? str.slice(0, -1) : str);

/**
 * Finds the entry for `priority` in a dense, priority-sorted pair of arrays, creating one if it is
 * not there yet. `order` holds the priorities and `list` the values at matching indices.
 *
 * Priority is deliberately NOT used as an array index. Indexing by priority leaves holes — hooks at
 * 25/50/75 produce a 76-element array with 73 of them empty — and these arrays are walked on every
 * render and every write, so the holes dominated the cost.
 *
 * @param list Values, ordered by ascending priority
 * @param order Priorities, parallel to `list`
 * @param priority Priority to find or create
 * @param create Builds the value when the priority is not present yet
 * @return The existing or newly created value
 */
export const prioritySlot = <T>(list: T[], order: number[], priority: number, create: () => T): T => {
  let slot = 0;
  while (slot < order.length && order[slot] < priority) slot++;
  if (order[slot] === priority) return list[slot];

  order.splice(slot, 0, priority);
  const created = create();
  list.splice(slot, 0, created);
  return created;
};
