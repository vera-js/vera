/**
 * The QUERY pack — state that lives in the URL, and lists that answer to it.
 *
 * Three directives that together make a filterable, paginated, shareable page out of markup a
 * server already rendered, with no templating and no client rendering of any kind:
 *
 * - `data-vd-route` — publishes the current route as `@route`, so expressions can read it.
 * - `data-vd-query` — binds state keys to the URL's query string, `persist`'s shape for links.
 * - `data-vd-region` — filters, sorts and paginates the items ALREADY INSIDE it.
 *
 * **`region` renders nothing, and that is the whole design.** The `each`-templating question was
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
 * filters; with the pack wired, `query` keeps the same parameters in the URL and `region` does the
 * work locally. One markup, both worlds, and a link to it always reproduces what the sender saw.
 */
import { isObject } from './parse.js';
import type { Directive, Ctx, EngineConnector } from './types.js';


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
    /** Empty means ABSENT: `?q=&tag=` is noise in a shared link. */
    if (value === null || value === undefined || value === '' || value === false) params.delete(key);
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

/* ── data-vd-query: state keys that live in the URL ──────────────────────────────────────── */

const queryDirective: Directive = {
  name: 'query',
  value: 'literal',
  priority: 16,
  docs: {
    summary: 'Binds state keys to the URL query string, so a filtered view is a shareable link.',
    example: 'data-vd-query="q tag page"',
  },
  setup(el, ctx) {
    const keys = (el.getAttribute('data-vd-query') ?? '')
      .split(/[\s,]+/)
      .filter(Boolean);
    if (!keys.length) {
      ctx.reject('query-no-keys', 'data-vd-query needs one or more state keys.',
        'Write data-vd-query="q tag page".');
      return;
    }

    /**
     * **The URL wins at activation.** That is the entire point: someone opened a link, and what
     * the link says beats what the markup seeded. A key the URL does not mention keeps its seed,
     * so a partial link is still a valid one.
     */
    const fromUrl = () => {
      const params = new URLSearchParams(location.search);
      for (const key of keys) {
        if (!params.has(key)) continue;
        const raw = params.get(key) ?? '';
        /** Numbers come back as numbers — `page` is arithmetic on the other side. */
        const numeric = raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : null;
        ctx.set(key, numeric !== null ? numeric : raw);
      }
    };
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

/* ── data-vd-region: filter, sort and paginate what is already here ──────────────────────── */

/** The text a filter matches against: named data fields if given, else everything the item says. */
const itemText = (item: Element, fields: readonly string[]): string => {
  if (!fields.length) return (item.textContent ?? '').toLowerCase();
  let out = '';
  for (const field of fields) out += ` ${item.getAttribute(`data-${field}`) ?? ''}`;
  return out.toLowerCase();
};

const region: Directive = {
  name: 'region',
  value: 'object',
  /** After `query` (16) and any state (10): it reads what those settle. */
  priority: 55,
  docs: {
    summary: 'Filters, sorts and paginates the items already inside this element — no templating.',
    example: "data-vd-region=\"{ items: '.card', search: 'q', size: 12 }\"",
  },
  apply(el, value, ctx) {
    if (!isObject(value as never)) {
      ctx.reject('region-not-object', 'data-vd-region takes a braced object.',
        "Write data-vd-region=\"{ items: '.card', search: 'q' }\".");
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
        ctx.reject('region-bad-selector', `"${selector}" is not a selector.`);
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

    const matched: Element[] = [];
    for (const item of items) {
      let keep = needle === '' || itemText(item, fields).includes(needle);
      if (keep) {
        for (const facet of facets) {
          const want = ctx.get(facet);
          if (want === undefined || want === null || want === '' || want === false) continue;
          if ((item.getAttribute(`data-${facet}`) ?? '') !== String(want)) {
            keep = false;
            break;
          }
        }
      }
      if (keep) matched.push(item);
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

    for (const item of items) (item as HTMLElement).hidden = !shown.has(item);

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
      const now = ctx.get(counts) as Record<string, number> | undefined;
      if (!now || now.matched !== next.matched || now.pages !== next.pages ||
          now.page !== next.page || now.total !== next.total) {
        ctx.set(counts, next);
      }
    }
    /** A clamped page is written back, or the URL and the view disagree about where you are. */
    if (pageKey && Number(ctx.get(pageKey) ?? 1) !== page) ctx.set(pageKey, page);
  },
};

/**
 * `wireDirectives([query])` — the pack. No options, and nothing starts until an element asks:
 * `data-vd-route` is what turns the listener on.
 */
export const query: EngineConnector = (seams) => {
  seams.directive(route);
  seams.directive(queryDirective);
  seams.directive(region);
};
