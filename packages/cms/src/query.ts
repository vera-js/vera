/**
 * The pure query core: entries in hand, entries out — no fetching, no caching, no environment.
 * `createReader` (the runtime convenience) and build-time code both sit on top of this, which is
 * why it lives apart from either: the same filter/sort/slice must answer identically in a browser,
 * a worker, and a Node build.
 *
 * The filter is a **predicate function** for now, deliberately: it is the JS-natural shape, and a
 * declarative, JSON-able `where` belongs with the schema layer that can type it — a serializable
 * query only becomes *safe to hand an agent* once fields have declared types to validate against.
 */
import { ManifestEntry } from './types.js';

/** A manifest row as a reader returns it — stamped with where it came from. */
export type ReaderEntry = ManifestEntry & { collection: string };

export type QueryOptions<E extends ManifestEntry> = {
  /** Keep an entry when this answers true. Absent, everything qualifies. */
  filter?: (entry: E) => boolean;
  /**
   * `'field'` ascending or `'field:desc'` — `date:desc` is the archetype. The field resolves from
   * the entry's frontmatter first, then the row itself (`slug` works). Absent, manifest order —
   * slug-sorted — stands.
   */
  sort?: string;
  /** Rows to skip before taking, for pagination. */
  offset?: number;
  /** Most rows to return. */
  limit?: number;
};

/**
 * Filters, sorts, and slices entries — the whole of what a listing page asks for.
 *
 * @param entries The rows to query, from one manifest or several concatenated
 * @param options Filter, sort, offset, limit — all optional; `{}` returns a copy in given order
 * @return The matching rows, a new array — inputs are never reordered in place
 */
export const queryEntries = <E extends ManifestEntry>(entries: E[], options: QueryOptions<E> = {}): E[] => {
  let result = options.filter === undefined ? [...entries] : entries.filter(options.filter);

  if (options.sort !== undefined) {
    const [field, direction] = options.sort.split(':');
    const sign = direction === 'desc' ? -1 : 1;
    result.sort((a, b) => {
      const left = keyOf(a, field);
      const right = keyOf(b, field);
      /**
       * Outside the direction flip on purpose: an entry missing the field trails in BOTH
       * directions. Flipped, `date:desc` would crown the undated entries — the first draft did
       * exactly that, and the comment below already promised otherwise.
       */
      if (left == null || right == null) {
        if (left != null) return -1;
        if (right != null) return 1;
        return compare(a.slug, b.slug);
      }
      return sign * compare(left, right) || compare(a.slug, b.slug);
    });
  }

  if (options.offset !== undefined) result = result.slice(options.offset);
  if (options.limit !== undefined) result = result.slice(0, options.limit);
  return result;
};

/** Frontmatter first, then the row — so `sort: 'slug'` needs no special spelling. */
const keyOf = (entry: ManifestEntry & { collection?: string }, field: string): unknown =>
  entry.data[field] !== undefined ? entry.data[field] : (entry as unknown as Record<string, unknown>)[field];

/**
 * Numbers numerically, everything else as code-unit strings — **never `localeCompare`**, whose
 * answer depends on the machine's locale, and a query that orders differently per machine is the
 * committed-recording trap wearing a new hat. Nullish never reaches here; the sort callback
 * handles it outside the direction flip.
 */
const compare = (a: unknown, b: unknown): number => {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const left = String(a);
  const right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
};
