/**
 * The QUERY pack — state that lives in the URL, and lists that answer to it.
 *
 * Three directives that together make a filterable, paginated, shareable page out of markup a
 * server already rendered, with no templating and no client rendering of any kind:
 *
 * - `data-vd-route` — publishes the current route as `@route`, so expressions can read it.
 * - `data-vd-query` — binds state keys to the URL's query string, `persist`'s shape for links.
 * - `data-vd-list` — filters, sorts and paginates the items ALREADY INSIDE it.
 *
 * **`list` renders nothing, and that is the whole design.** The `each`-templating question was
 * settled as "not in v1 — vera has a renderer"; the answer for a zero-JS page is not to template
 * on the client but to let the server send the list it was always going to send and REFLECT over
 * it. So the page is complete and readable with JavaScript off, indexable by a crawler, and
 * correct before the engine boots — and turning it interactive costs hiding some children.
 *
 * That is also why this is a DIRECTIVE and not the component §10 planned. The plan assumed the
 * implementation would render a list, which makes it a noun; this one writes `hidden` on children
 * it did not create, which is an adjective by the same grammar. Recorded as a deliberate
 * revision: the premise changed, so the conclusion did.
 *
 * **Progressive enhancement is real here, not aspirational.** Write the filter UI as an ordinary
 * `<form method="get">` with named inputs: with no JavaScript the form submits and the server
 * filters; with the pack wired, `query` keeps the same parameters in the URL and `list` does the
 * work locally. One markup, both worlds, and a link to it always reproduces what the sender saw.
 */
import { claimCommit, commitFlip } from './flip.js';
import { isObject } from './parse.js';
import type { Directive, Ctx, EngineConnector, ListChange } from './types.js';


/**
 * One listener for the whole page, however many directives subscribe.
 *
 * `vera:after-route` is `@verajs/router`'s own event — bubbling and composed, so `document` sees
 * it from any router on the page, in any shadow root. Listening for it rather than importing the
 * router is what keeps this pack dependency-free in both directions: a page with no router still
 * gets `popstate` and the initial read, and a page with someone else's router gets whatever it
 * dispatches through the same two channels.
 */
const listeners = new Set<() => void>();
let listening = false;

const startListening = (): void => {
  if (listening) return;
  listening = true;
  const notify = () => {
    for (const fn of [...listeners]) fn();
  };
  document.addEventListener('vera:after-route', notify);
  window.addEventListener('popstate', notify);
};

const subscribe = (fn: () => void): (() => void) => {
  startListening();
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** The URL's query as a plain object — what `@route.query.tab` walks. */
const queryObject = (): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(location.search)) out[key] = value;
  return out;
};

/**
 * Writes the URL without navigating: a filter is not a new page, it is the same page seen
 * differently. `replaceState` rather than `pushState` for exactly that reason — a search box
 * would otherwise put one history entry per keystroke and make the back button useless, which is
 * the single most common complaint about URL-bound filters.
 */
const writeQuery = (updates: Record<string, unknown>): void => {
  const params = new URLSearchParams(location.search);
  for (const [key, value] of Object.entries(updates)) {
    /** Empty means ABSENT: `?q=&tag=` is noise in a shared link — and so is `?tags=`. */
    if (value === null || value === undefined || value === '' || value === false ||
        (Array.isArray(value) && value.length === 0)) params.delete(key);
    /**
     * Arrays travel comma-joined (`?tags=css,js`) — the multi-facet shape. Each entry is
     * URI-encoded FIRST, so a value that itself contains a comma survives the round trip: the
     * separator commas are ours, any `%2C` inside an entry is the value's. Slug-shaped values
     * (the overwhelmingly common case) are untouched by the encoding, so their links stay
     * readable.
     */
    else if (Array.isArray(value)) params.set(key, value.map((v) => encodeURIComponent(String(v))).join(','));
    else params.set(key, String(value));
  }
  const search = params.toString();
  const next = `${location.pathname}${search ? `?${search}` : ''}${location.hash}`;
  if (next === `${location.pathname}${location.search}${location.hash}`) return;
  history.replaceState(history.state, '', next);
};

/* ── data-vd-route: the route, as readable state ─────────────────────────────────────────── */

const route: Directive = {
  name: 'route',
  value: 'none',
  priority: 15,
  docs: {
    summary: 'Publishes the current route as @route — path, query and hash, readable in any expression.',
    example: 'data-vd-route',
  },
  /**
   * On the app shell, once. Explicit rather than automatic because nothing in this system wires
   * itself: a page that never reads `@route` should not pay a listener, and a page that does
   * should be able to see where it was turned on.
   */
  /**
   * On a SERVER there is a location and no navigation, so publishing once is the whole job — and
   * it must happen, because everything downstream reads `@route`. The shim provides a per-request
   * `location`, which is exactly what the function form of `ssr` was added for and what nothing
   * in the package used until now.
   */
  ssr: (_el, _value, ctx) => {
    ctx.set('@route', { path: location.pathname, query: queryObject(), hash: location.hash.slice(1) });
  },
  setup(_el, ctx) {
    const publish = () => {
      ctx.set('@route', {
        path: location.pathname,
        query: queryObject(),
        hash: location.hash.slice(1),
      });
    };
    publish();
    return subscribe(publish);
  },
};

/**
 * Seeds the named keys from the URL's parameters. **The markup's seed declares the SHAPE**: a key
 * whose current value is an array comes back as one — split on the commas `writeQuery` joined —
 * because a URL parameter cannot say which it meant and the seed already does. A search string
 * with a comma in it stays a string for the same reason. Numbers come back as numbers — `page`
 * is arithmetic on the other side.
 */
const seedFromUrl = (keys: readonly string[], ctx: { get(key: string): unknown; set(key: string, value: unknown): void }): void => {
  const params = new URLSearchParams(location.search);
  for (const key of keys) {
    /**
     * READERS ARE LIBERAL (conventions Law 1): the canonical write is comma-joined in one
     * parameter, but a `[]`-suffixed name — PHP's declared array form, which omni's engine
     * emits — and plain repeated parameters are both accepted. The NAME declares the shape,
     * the same logic as shape-from-seed: entries under a declared-repeated spelling are never
     * comma-split, because there the commas are the value's own.
     */
    const gathered = [...params.getAll(key), ...params.getAll(`${key}[]`)];
    if (gathered.length === 0) continue;
    const raw = gathered[0];
    if (Array.isArray(ctx.get(key))) {
      const declaredRepeated = gathered.length > 1 || params.has(`${key}[]`);
      ctx.set(key, declaredRepeated
        ? gathered.filter((entry) => entry !== '')
        : raw === '' ? [] : raw.split(',').map((entry) => decodeURIComponent(entry)));
      continue;
    }
    const numeric = raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : null;
    ctx.set(key, numeric !== null ? numeric : raw);
  }
};

/* ── data-vd-query: state keys that live in the URL ──────────────────────────────────────── */

const queryDirective: Directive = {
  name: 'query',
  value: 'literal',
  priority: 16,
  docs: {
    summary: 'Binds state keys to the URL query string, so a filtered view is a shareable link.',
    example: 'data-vd-query="q tag page"',
  },
  /**
   * The read half only. A server has the URL the reader asked for, and seeding from it is the
   * whole reason a shared link reproduces what the sender saw — without this, the server renders
   * the markup's SEED and the client corrects it after boot, which is the flash this pack exists
   * to prevent. The write half (history) is meaningless here and is not run.
   */
  ssr: (el, _value, ctx) => {
    seedFromUrl((el.getAttribute('data-vd-query') ?? '').split(/[\s,]+/).filter(Boolean), ctx);
  },
  setup(el, ctx) {
    const keys = (el.getAttribute('data-vd-query') ?? '')
      .split(/[\s,]+/)
      .filter(Boolean);
    if (!keys.length) {
      ctx.reject('query-no-keys');
      return;
    }

    /**
     * **The URL wins at activation.** That is the entire point: someone opened a link, and what
     * the link says beats what the markup seeded. A key the URL does not mention keeps its seed,
     * so a partial link is still a valid one.
     */
    const fromUrl = () => seedFromUrl(keys, ctx);
    fromUrl();
    const stop = subscribe(fromUrl);

    return {
      teardown: stop,
      /**
       * The write half. It runs inside the engine's hook, so READING the keys here is what
       * subscribes it — this is the ordinary reflection shape, and the URL is just another
       * surface being reflected onto.
       */
      apply: (_element: Element, _value: unknown, context: Ctx) => {
        const updates: Record<string, unknown> = {};
        for (const key of keys) updates[key] = context.get(key);
        writeQuery(updates);
      },
    };
  },
};

/* ── data-vd-list: filter, sort and paginate what is already here ────────────────────────── */

/** The text a filter matches against: named data fields if given, else everything the item says. */
const itemText = (item: Element, fields: readonly string[]): string => {
  if (!fields.length) return (item.textContent ?? '').toLowerCase();
  let out = '';
  for (const field of fields) out += ` ${item.getAttribute(`data-${field}`) ?? ''}`;
  return out.toLowerCase();
};

/**
 * Sorts matched items by an item data-attribute, per the spec a STATE key holds — `'price'` or
 * `'price desc'` — so a sort dropdown is just `data-vd-sync` on the same key. Numeric when both
 * sides parse as numbers, `localeCompare` otherwise; an item without the attribute sorts last.
 */
/** Host → each item's server-rendered position, captured before the first reorder. */
const serverOrder = new WeakMap<Element, Map<Element, number>>();

/** Host → the last search needle, for the DISCRETE/CONTINUOUS split (see `animate`). */
const lastNeedle = new WeakMap<Element, string>();

/**
 * Host → the counts last WRITTEN, for compare-before-write. A WeakMap and not a state read,
 * decisively: reading the key back through ctx SUBSCRIBED the list to its own write, and the
 * echo re-entered apply MID-APPLY — before the commit — where it saw the same needle
 * (discrete!), the still-uncommitted changes, and wrapped them in a second transition racing
 * the first's snapshots. Every animation artifact of the first live build (typing fades,
 * sort's shrink-and-regrow, checkboxes animating nothing) was this one echo.
 */
const lastCounts = new WeakMap<Element, { matched: number; pages: number; page: number; total: number }>();

/** Hosts mid-apply: a re-entrant apply (any subscription echo) is redundant BY CONSTRUCTION —
 *  the outer pass writes the final state — and can only ever see half-applied DOM. Skipped. */
const applying = new WeakSet<Element>();

const compareBy = (field: string, desc: boolean) => (a: Element, b: Element): number => {
  const left = a.getAttribute(`data-${field}`);
  const right = b.getAttribute(`data-${field}`);
  if (left === null || right === null) return (left === null ? 1 : 0) - (right === null ? 1 : 0);
  const ln = Number(left);
  const rn = Number(right);
  const out = left !== '' && right !== '' && Number.isFinite(ln) && Number.isFinite(rn)
    ? ln - rn
    : left.localeCompare(right);
  return desc ? -out : out;
};

const list: Directive = {
  name: 'list',
  value: 'object',
  /** After `query` (16) and any state (10): it reads what those settle. */
  priority: 55,
  docs: {
    summary: 'Filters, sorts and paginates the items already inside this element — no templating.',
    example: "data-vd-list=\"{ items: '.card', search: 'q', size: 12 }\"",
  },
  /**
   * **The pack's whole premise is server-first and it was not running on the server.** A shared
   * `?q=foo&page=3` link served every item visible and let the client hide the rest — a flash of
   * unfiltered content and a hydration divergence, in the system that claims divergence is
   * structurally impossible rather than merely tested for. The apply is pure DOM reads and
   * `hidden` writes, which the shim reflects, so the declaration is one word.
   */
  ssr: true,
  apply(el, value, ctx) {
    if (applying.has(el)) return;
    applying.add(el);
    try {
    if (!isObject(value as never)) {
      ctx.reject('list-not-object');
      return;
    }
    const cfg = value as Record<string, unknown>;
    const read = (key: string): unknown => ctx.eval(cfg[key]);

    /** Default: the element's own children. A selector narrows it for wrapped layouts. */
    const selector = read('items');
    let items: Element[];
    if (typeof selector === 'string' && selector !== '') {
      try {
        items = [...el.querySelectorAll(selector)];
      } catch {
        ctx.reject('list-bad-selector', [selector]);
        return;
      }
    } else {
      items = [...el.children];
    }

    /** The needle: whatever the named state key currently holds. */
    const searchKey = read('search');
    const needle = typeof searchKey === 'string' && searchKey !== ''
      ? String(ctx.get(searchKey) ?? '').trim().toLowerCase()
      : '';
    const fields = typeof read('fields') === 'string'
      ? String(read('fields')).split(/[\s,]+/).filter(Boolean)
      : [];

    /**
     * FACETS: `{ facets: 'tag level' }` matches each named field against the state key of the
     * same name — the shape a CMS page actually needs, where a sidebar of checkboxes writes
     * `tag`/`level` and the list answers. An empty facet key matches everything, so an unset
     * filter is not a filter.
     */
    const facets = typeof read('facets') === 'string'
      ? String(read('facets')).split(/[\s,]+/).filter(Boolean)
      : [];

    /**
     * RANGES: `{ ranges: 'price' }` is `facets`' numeric sibling — each name reads the FLAT state
     * keys `price-min` and `price-max` and keeps items whose `data-price` falls inside. Flat and
     * hyphenated because a dotted key is readable but deliberately not writable here, and these
     * two exist to be written by a pair of `sync`ed range inputs. An unset bound is no bound
     * (facets' "an unset filter is not a filter" rule); an item that is not a number fails any
     * ACTIVE bound rather than slipping through it.
     */
    const ranges = typeof read('ranges') === 'string'
      ? String(read('ranges')).split(/[\s,]+/).filter(Boolean)
      : [];
    const unset = (bound: unknown): boolean =>
      bound === undefined || bound === null || bound === '' || bound === false;

    const matched: Element[] = [];
    for (const item of items) {
      let keep = needle === '' || itemText(item, fields).includes(needle);
      if (keep) {
        for (const facet of facets) {
          const want = ctx.get(facet);
          if (unset(want)) continue;
          const has = item.getAttribute(`data-${facet}`) ?? '';
          /** An array facet is a multi-select: the item matches ANY listed value; an empty
           *  array, like an unset scalar, is not a filter. */
          if (Array.isArray(want)) {
            if (want.length > 0 && !want.map(String).includes(has)) {
              keep = false;
              break;
            }
          } else if (has !== String(want)) {
            keep = false;
            break;
          }
        }
      }
      if (keep) {
        for (const range of ranges) {
          const min = ctx.get(`${range}-min`);
          const max = ctx.get(`${range}-max`);
          if (unset(min) && unset(max)) continue;
          const own = Number(item.getAttribute(`data-${range}`) ?? NaN);
          if (!Number.isFinite(own) ||
              (!unset(min) && own < Number(min)) ||
              (!unset(max) && own > Number(max))) {
            keep = false;
            break;
          }
        }
      }
      if (keep) matched.push(item);
    }

    const reorders: Array<[Node, readonly Element[]]> = [];
    const movers = new Set<Element>();
    /**
     * SORT reorders the matched items in place — still reflection, not templating: the nodes are
     * the server's, only their order changes. The spec lives in STATE (`sort: 's'`, state `s`
     * holding `'price'` or `'price desc'`) so a dropdown drives it with nothing but `sync`.
     * Items are re-inserted per parent, and only when the current order is actually wrong —
     * an in-order apply must not touch the DOM, or every state write pays a reflow.
     */
    const sortKey = typeof read('sort') === 'string' && read('sort') !== '' ? String(read('sort')) : null;
    if (sortKey) {
      /** The server's order, remembered on first sight — clearing the sort must RESTORE it, or
       *  a "default" dropdown option leaves the last sort stuck in the DOM forever. */
      let original = serverOrder.get(el);
      if (!original) serverOrder.set(el, (original = new Map(items.map((item, i) => [item, i]))));
      const spec = String(ctx.get(sortKey) ?? '').trim();
      const [field, direction] = spec.split(/\s+/);
      const compare = spec !== ''
        ? compareBy(field!, direction === 'desc')
        : (a: Element, b: Element) => (original.get(a) ?? 0) - (original.get(b) ?? 0);
      matched.sort(compare);
      const byParent = new Map<Node, Element[]>();
      for (const item of matched) {
        const parent = item.parentNode;
        if (parent) {
          let group = byParent.get(parent);
          if (!group) byParent.set(parent, (group = []));
          group.push(item);
        }
      }
      for (const [parent, ordered] of byParent) {
        const wanted = new Set<Node>(ordered);
        const current = [...parent.childNodes].filter((node) => wanted.has(node));
        if (ordered.some((item, i) => item !== current[i])) {
          /** Computed here, MOVED in the commit — and every mover is a `changed` item, so the
           *  animated path names exactly what travels. */
          reorders.push([parent, ordered]);
          for (const [i, item] of ordered.entries()) if (item !== current[i]) movers.add(item);
        }
      }
    }

    /**
     * PAGINATION over the matched set, not the whole list — a page number means "of the results",
     * which is what every reader assumes and what a stale `page` in a shared link must survive.
     * A page past the end shows the last one rather than an empty void.
     */
    const size = Number(read('size'));
    const paged = Number.isFinite(size) && size > 0;
    const pageKey = typeof read('page') === 'string' ? String(read('page')) : null;
    const pages = paged ? Math.max(1, Math.ceil(matched.length / size)) : 1;
    const wanted = pageKey ? Number(ctx.get(pageKey) ?? 1) : 1;
    const page = Math.min(Math.max(Number.isFinite(wanted) ? wanted : 1, 1), pages);
    const visible = paged ? matched.slice((page - 1) * size, page * size) : matched;
    const shown = new Set(visible);

    /** Everything below is computed HERE, synchronously — `commit` closes over plain data and
     *  never touches ctx, because an animated commit runs after this scope is gone. Changes are
     *  TYPED (`ListChange`; kind → treatment table in flip.ts) — this directive only PRODUCES
     *  facts about what changed; whether and how they animate is the flip door's decision. */
    const changed: { item: Element; kind: ListChange['kind'] }[] = [];
    for (const item of items) {
      if ((item as HTMLElement).hidden === shown.has(item)) changed.push({ item, kind: 'fade' });
    }
    /** THE FIRST APPLY IS ESTABLISHMENT, NOT RESPONSE. A load with URL state restores the
     *  saved view before anyone touches anything; classifying it discrete animated the page
     *  settling into itself — server order visibly shuffling into the URL's filters on every
     *  refresh (found live on the flip-lab). Nothing has a "last" on the first pass, so the
     *  needle map doubles as the marker. */
    const first = !lastNeedle.has(el);
    const discrete = !first && needle === lastNeedle.get(el);
    lastNeedle.set(el, needle);
    const animate = read('animate') === true;
    for (const mover of movers) {
      const existing = changed.find((c) => c.item === mover);
      if (existing) (existing as { kind: string }).kind = 'move';
      else changed.push({ item: mover, kind: 'move' });
    }
    const current = claimCommit(el);
    const doCommit = () => {
      if (!current()) return; /* superseded — a newer commit owns the DOM */
      for (const item of items) (item as HTMLElement).hidden = !shown.has(item);
      for (const [parent, ordered] of reorders) {
        for (const item of ordered) parent.appendChild(item);
      }
    };

    /**
     * The counts go back into state, so the page's own markup can say "12 results" and build page
     * controls with nothing but `data-vd-text` and `data-vd-on-click`.
     *
     * **Written only when they CHANGE**, which is not a micro-optimisation: this apply runs inside
     * a hook, a write re-runs every hook that read the key, and an unconditional write of a value
     * that is already there would re-run this one for ever. The engine cannot know that for us —
     * a directive that both reads and writes state owns its own fixed point.
     */
    const counts = typeof read('counts') === 'string' ? String(read('counts')) : null;
    if (counts) {
      const next = { matched: matched.length, pages, page, total: items.length };
      const now = lastCounts.get(el);
      if (!now || now.matched !== next.matched || now.pages !== next.pages ||
          now.page !== next.page || now.total !== next.total) {
        lastCounts.set(el, next);
        ctx.set(counts, next);
      }
    }
    /** A clamped page is written back, or the URL and the view disagree about where you are. */
    if (pageKey && Number(ctx.get(pageKey) ?? 1) !== page) ctx.set(pageKey, page);

    /** LAST, after every ctx read and write above is done: the DOM commit, through the flip
     *  door — its guard table decides instant vs animated (establishment and typing never
     *  animate; see flip.ts). */
    commitFlip({ doc: el.ownerDocument!, animate, first, discrete, changes: changed }, doCommit);
    } finally {
      applying.delete(el);
    }
  },
};

/**
 * `wireDirectives([query])` — the pack. No options, and nothing starts until an element asks:
 * `data-vd-route` is what turns the listener on.
 */
export const query: EngineConnector = (seams) => {
  seams.directive(route);
  seams.directive(queryDirective);
  seams.directive(list);
};
