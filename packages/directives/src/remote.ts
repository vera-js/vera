/**
 * The REMOTE pack — `data-vd-fetch`: server-driven interactions, for pages whose truth lives on
 * the server (a cart total, a permission, a search result) rather than in a browser store.
 *
 * **One directive, and the response decides what happens.** A JSON object is a STATE PATCH,
 * applied to the nearest carrier — every existing reflection then updates itself, so there is no
 * swap vocabulary to learn and no second rendering path. Anything else is MARKUP, swapped into a
 * target — and swapped markup is live the instant it lands, because directives are never
 * hydrated: the engine's churn activation adopts it and delegation was already matching handlers
 * by attribute. That is why this pack is small. It adds a request; everything after the response
 * is machinery that already existed.
 *
 * ```html
 * <button data-vd-fetch="{ url: '/cart/add', on: 'click', body: { id: 7 }, status: 'cart' }">add</button>
 * <form   data-vd-fetch="{ url: '/search', on: 'submit', into: '#results' }">…</form>
 * <div id="results" data-vd-fetch="{ url: '/feed', on: 'load' }"></div>
 * ```
 *
 * **The security posture, which is the whole reason this file is careful.** A request maker aimed
 * by markup is exactly the thing CODE-PRINCIPLES #8 is about, so:
 *
 * - **Same-origin by default**, and only a FACTORY allowlist widens it — `remote({ allowedOrigins })`
 *   is JavaScript the page author wrote, never an attribute. The same rule the sequence module
 *   follows, for the same reason: an attribute may be authored by a CMS, a template someone else
 *   fills, or an attacker who can write attributes.
 * - **HTML is swapped SAME-ORIGIN ONLY, always.** Swapped markup executes with your page's
 *   authority; an allowlisted third party may return data, never a document. There is no option
 *   to turn this off, because there is no honest reason to want one.
 * - Every URL goes through the platform parser and must resolve to `http(s):` — `javascript:`,
 *   `data:` and `blob:` are refused before a request exists.
 *
 * **Ordering is a correctness question, not a nicety.** A second request from one element aborts
 * the first, so a fast-typing search box cannot have an early response land after a late one and
 * write stale state — the bug every hand-rolled version of this has.
 */
import { dual } from './dual.js';
import { claimCommit, commitFlip } from './flip.js';
import { isObject } from './parse.js';
import type { Directive, Ctx, EngineConnector, ListChange } from './types.js';


export interface RemoteOptions {
  /**
   * Origins this pack may request beyond the page's own. FACTORY ONLY — an attribute can never
   * widen it. Cross-origin responses are read as JSON state patches; markup from another origin
   * is never swapped, whatever the response says.
   */
  readonly allowedOrigins?: readonly string[];
  /** Headers sent with every request — where a CSRF token belongs. */
  readonly headers?: Readonly<Record<string, string>>;
}

/** Page-level policy, set by the factory before any element activates. */
let allowedOrigins: string[] = [];
let headers: Record<string, string> = {};

/**
 * The URL a value names, or null. Refuses anything that is not `http(s):`, and anything
 * off-origin the factory did not allow. Returns whether it is same-origin, because the HTML-swap
 * rule depends on it and deciding that twice is how the two answers drift apart.
 */
const resolveUrl = (raw: unknown): { href: string; sameOrigin: boolean } | null => {
  if (typeof raw !== 'string' || raw === '') return null;
  let url: URL;
  try {
    url = new URL(raw, location.href);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const sameOrigin = url.origin === location.origin;
  if (!sameOrigin && !allowedOrigins.includes(url.origin)) return null;
  return { href: url.href, sameOrigin };
};

/** GET responses held for `cache:` replay — keyed by resolved URL, shared across elements. */
const responseCache = new Map<string, { at: number; type: string; body: string }>();

/** Elements already warned about URL-bound feed depth — the pun guard fires once per element. */
const warnedFeedDepth = new WeakSet<Element>();

/** The element a swap writes into: a selector, or the element itself. */
const swapTarget = (el: Element, into: unknown): Element | null => {
  if (into === undefined || into === 'self') return el;
  if (typeof into !== 'string') return null;
  try {
    /** The element's own root, so a selector works inside a shadow root. */
    return (el.getRootNode() as Document | ShadowRoot).querySelector(into);
  } catch {
    return null;
  }
};

const fetchDirective: Directive = {
  name: 'fetch',
  value: 'object',
  priority: 70,
  docs: {
    summary: 'Requests a URL on an event; a JSON response patches state, markup is swapped in.',
    example: "data-vd-fetch=\"{ url: '/cart/add', on: 'click', body: { id: 7 } }\"",
  },
  setup() {
    return {
      /**
       * The configuration arrives as the directive's VALUE, so an edit re-runs this — which is
       * how a URL built from state (`{ url: '/search?q=' }` plus a synced key) stays current
       * without this pack inventing interpolation.
       */
      apply: (element: Element, value: unknown, context: Ctx) => {
        if (!isObject(value as never)) {
          context.reject('fetch-not-object');
          return;
        }
        /**
         * An object directive's VALUES stay lazy — that is the engine's contract, and it is why
         * `class` and `style` evaluate per entry. So every key is read through `ctx.eval`, which
         * costs nothing and buys the thing that matters: a configuration built from STATE.
         * `{ url: '/search?q=' + query }` re-runs this apply whenever `query` changes, so the
         * request follows the page without this pack inventing an interpolation syntax.
         */
        const cfg = value as Record<string, unknown>;
        const read = (key: string): unknown => context.eval(cfg[key]);
        /** Bodies nest, and their leaves are lazy for the same reason. */
        const deep = (node: unknown): unknown => {
          if (isObject(node as never)) {
            const out: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = deep(v);
            return out;
          }
          return context.eval(node);
        };
        const target = resolveUrl(read('url'));
        if (!target) {
          context.reject('fetch-url-refused', [String(read('url'))]);
          return;
        }

        const trigger = typeof read('on') === 'string' ? (read('on') as string) : 'click';
        const status = typeof read('status') === 'string' ? (read('status') as string) : null;
        const method = typeof read('method') === 'string'
          ? (read('method') as string).toUpperCase()
          : read('body') !== undefined ? 'POST' : 'GET';

        /**
         * `cache: 60` — seconds a GET's response stays reusable, keyed by the resolved URL and
         * shared across elements (two widgets polling one endpoint cost one request). Fresh
         * hits replay the stored body through the SAME response law, so a cached JSON patch
         * and a cached markup swap behave exactly as their first landing did. POST and friends
         * never cache — a mutation's answer is not a value.
         */
        const cacheRaw = read('cache');
        const cacheFor = typeof cacheRaw === 'number' && cacheRaw > 0 ? cacheRaw * 1000 : 0;
        if (cacheRaw !== undefined && cacheFor === 0) context.reject('fetch-bad-cache', [String(cacheRaw)]);

        /** One in flight per element: a later request aborts an earlier one, so a slow response
         *  can never land after a fast one and write stale state. */
        let inflight: AbortController | null = null;

        const run = async (event?: Event): Promise<void> => {
          /** A form's own navigation is not what was asked for. */
          if (event && trigger === 'submit') event.preventDefault();
          inflight?.abort();
          const controller = new AbortController();
          inflight = controller;
          if (status) context.set(status, 'loading');

          try {
            if (cacheFor && method === 'GET') {
              const held = responseCache.get(target.href);
              if (held && Date.now() - held.at < cacheFor) {
                applyResponse(held.type, held.body);
                if (status) context.set(status, 'idle');
                return;
              }
            }
            const response = await fetch(target.href, {
              method,
              signal: controller.signal,
              credentials: 'same-origin',
              headers: {
                ...headers,
                ...(read('body') !== undefined ? { 'content-type': 'application/json' } : {}),
                /** So a server can render a fragment rather than a whole page for these. */
                'x-vera-fetch': '1',
              },
              ...(read('body') !== undefined ? { body: JSON.stringify(deep(cfg['body'])) } : {}),
            });

            if (!response.ok) {
              if (status) context.set(status, 'error');
              context.reject('fetch-failed', [target.href, String(response.status)]);
              return;
            }

            const type = response.headers.get('content-type') ?? '';
            const body = await response.text();
            if (cacheFor && method === 'GET') responseCache.set(target.href, { at: Date.now(), type, body });
            applyResponse(type, body);
            if (status) context.set(status, 'idle');
          } catch (error) {
            /** An abort is this pack's own doing — the successor request owns the outcome. */
            if ((error as Error)?.name === 'AbortError') return;
            if (status) context.set(status, 'error');
            context.reject('fetch-threw', [String((error as Error)?.message ?? error)]);
          } finally {
            if (inflight === controller) inflight = null;
          }
        };

        /** ONE RESPONSE LAW, both arrivals: the wire and the cache replay come through here,
         *  so a cached JSON patch or markup swap behaves exactly as its first landing did. */
        const applyResponse = (type: string, body: string): void => {
            if (type.includes('json')) {
              /** A STATE PATCH. Every reflection already reads these keys, so nothing here
               *  renders anything — the page updates itself. */
              const data: unknown = JSON.parse(body);
              if (data && typeof data === 'object' && !Array.isArray(data)) {
                for (const [key, patch] of Object.entries(data as Record<string, unknown>)) {
                  /** `_vd` is the engine's reserved prefix; a server may not write there. */
                  if (key.startsWith('_vd')) continue;
                  context.set(key, patch);
                }
              } else {
                context.reject('fetch-json-not-object');
              }
            } else {
              /**
               * MARKUP — and the same-origin rule is absolute here: swapped markup runs with this
               * page's authority, so an allowlisted third party may send data and never a
               * document. Refused after the response rather than before, because only the
               * response says which kind it is.
               */
              if (!target.sameOrigin) {
                if (status) context.set(status, 'error');
                context.reject('fetch-foreign-markup');
                return;
              }
              const into = swapTarget(element, read('into'));
              if (!into) {
                context.reject('fetch-target-missing', [String(read('into'))]);
                return;
              }
              /**
               * No hydration step, and none is missing: the engine's churn activation adopts the
               * new subtree, and delegated handlers inside it were already being matched by
               * attribute — the markup is live the moment it lands.
               *
               * The swap goes through the FLIP DOOR (`animate: true` opts in): the region morphs
               * old-to-new — the platform crossfade is the LEAVE animation removed content never
               * had, and it degrades to today's instant swap wherever the door's guards refuse.
               * `on: 'load'` is establishment (initial content, answers no one), so it never
               * animates — the same rule the list's URL restore learned. A stale response's
               * commit is already impossible (the successor aborts it), but the door's claim
               * also covers the transition callback's async window.
               */
              /**
               * `place` decides where the markup lands: replace (the default), or append/prepend
               * for accumulating shapes — infinite scroll is `on: 'vera:in-view'` + `place:
               * 'append'` + a page key, three existing pieces composing. Everything already
               * inside the target is untouched (its state, its handlers, its DOM), because
               * insertAdjacentHTML parses into position rather than re-writing the container.
               */
              const place = read('place') ?? 'replace';
              if (place !== 'replace' && place !== 'append' && place !== 'prepend') {
                context.reject('fetch-place-unknown', [String(place)]);
                return;
              }
              /**
               * THE PUN GUARD (conventions Law 1): `page` may mean "the Nth window" (list's
               * paged view — replace semantics, shareable-complete) or "depth reached" (a
               * feed). An ACCUMULATING request whose own URL carries a `data-vd-query`-bound
               * key is the second wearing the first's clothes, and a shared link then opens
               * with holes — pages 2..N-1 were DOM, not URL. Advisory, not a refusal: the
               * request is fine, the sharing story is what breaks.
               */
              if (__DEV__ && place !== 'replace' && !warnedFeedDepth.has(element)) {
                const bound = element.closest('[data-vd-query]')?.getAttribute('data-vd-query');
                const requested = new URL(target.href).searchParams;
                const pun = (bound ?? '').split(/[\s,]+/).filter(Boolean)
                  .find((key) => requested.has(key) || requested.has(`${key}[]`));
                if (pun) {
                  warnedFeedDepth.add(element);
                  console.warn(
                    `[vera] fetch: this accumulating feed's "${pun}" is URL-bound through data-vd-query, ` +
                    `so a shared link opens with holes — the middle pages were DOM, not URL. ` +
                    `A feed shares a POSITION: an item fragment (#id), or a server cursor the ` +
                    `establishment request can start from. Keep "${pun}" out of data-vd-query.`
                  );
                }
              }
              const markup = body;
              const current = claimCommit(into);
              /**
               * The kinds say what actually happens. A replace is one region morphing (`swap`).
               * An accumulation is finer: the arrivals are `enter` changes — born inside the
               * commit, so they reach the door through its `after` producer and get their own
               * entrances instead of riding a whole-container morph — and a prepend's existing
               * children are `move` changes, because they genuinely travel.
               */
              const preChanges: ListChange[] =
                place === 'replace' ? [{ item: into, kind: 'swap' }]
                : place === 'prepend' ? [...into.children].map((item) => ({ item, kind: 'move' as const }))
                : [];
              let mark = -1;
              commitFlip({
                doc: element.ownerDocument!,
                animate: read('animate') === true,
                first: trigger === 'load',
                discrete: true,
                changes: preChanges,
                ...(place === 'replace' ? {} : {
                  after: (): ListChange[] => {
                    if (mark < 0) return []; /* superseded — the commit never ran */
                    const children = [...into.children];
                    const arrivals = place === 'append'
                      ? children.slice(mark)
                      : children.slice(0, children.length - mark);
                    return arrivals.map((item) => ({ item, kind: 'enter' as const }));
                  },
                }),
              }, () => {
                if (!current()) return;
                mark = into.children.length;
                if (place === 'replace') into.innerHTML = markup;
                else into.insertAdjacentHTML(place === 'append' ? 'beforeend' : 'afterbegin', markup);
              });
            }
        };

        /**
         * DEBOUNCE, on the request maker because that is where the cost is: `debounce: 250`
         * holds the request until the trigger has been quiet that long — filter-as-you-type
         * stops firing one request per keystroke, which was this key's founding complaint.
         * The state write itself stays instant (sync is local and cheap); only the wire waits.
         */
        const debounceRaw = read('debounce');
        const debounce = typeof debounceRaw === 'number' && debounceRaw > 0 ? debounceRaw : 0;
        if (debounceRaw !== undefined && debounce === 0) context.reject('fetch-bad-debounce', [String(debounceRaw)]);
        let held: ReturnType<typeof setTimeout> | null = null;
        const fire = (event?: Event): void => {
          if (event && trigger === 'submit') event.preventDefault();
          if (!debounce) {
            void run(event);
            return;
          }
          if (held) clearTimeout(held);
          held = setTimeout(() => { held = null; void run(); }, debounce);
        };

        /** `on: 'load'` means AT ACTIVATION — the same word, and the same meaning, `on-load` has. */
        if (trigger === 'load') {
          void run();
          return;
        }
        element.addEventListener(trigger, fire);
        return () => {
          if (held) clearTimeout(held);
          inflight?.abort();
          element.removeEventListener(trigger, fire);
        };
      },
    };
  },
};

/* ── data-vd-stream: the live half — the server speaks, the page reflects ─────────────────── */

/**
 * The URL a stream may open, or null. The scheme picks the TRANSPORT — `http(s):` is an
 * EventSource, `ws(s):` a WebSocket — and same-origin is judged on the SCHEME-MAPPED origin
 * (`wss://site` IS `https://site`: one host, one authority, two protocols). The factory
 * allowlist accepts either spelling of a widened origin.
 */
const resolveStreamUrl = (raw: unknown): { href: string; sameOrigin: boolean; transport: 'sse' | 'ws' } | null => {
  if (typeof raw !== 'string' || raw === '') return null;
  let url: URL;
  try {
    url = new URL(raw, location.href);
  } catch {
    return null;
  }
  const socket = url.protocol === 'ws:' || url.protocol === 'wss:';
  if (!socket && url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const mapped = socket ? url.origin.replace(/^ws/, 'http') : url.origin;
  const sameOrigin = mapped === location.origin;
  if (!sameOrigin && !allowedOrigins.includes(url.origin) && !allowedOrigins.includes(mapped)) return null;
  return { href: url.href, sameOrigin, transport: socket ? 'ws' : 'sse' };
};

interface StreamSub {
  readonly element: Element;
  readonly context: Ctx;
  into: unknown;
  status: string | null;
  lastStatus?: string;
  animate: boolean;
  events: readonly string[];
}

/**
 * CONNECTIONS ARE SHARED PER URL — a page with five live regions on one feed holds ONE
 * connection, which is not a nicety: HTTP/1.1 allows six connections per origin, so five
 * unshared EventSources plus the page's own traffic is a stalled page. Subscribers carry their
 * own targets and status keys; the connection carries the wire.
 */
interface SharedStream {
  readonly transport: 'sse' | 'ws';
  readonly sameOrigin: boolean;
  readonly subs: Set<StreamSub>;
  source: EventSource | WebSocket | null;
  /** ws only: messages sent before the socket opens wait here, flushed on open. */
  readonly queue: string[];
  retry: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** sse only: event name → the attached dispatcher, so a stale name can be detached. */
  readonly listening: Map<string, (event: Event) => void>;
}

const streams = new Map<string, SharedStream>();

/** The ws send queue's ceiling. A dead server plus a chatty page must not grow memory forever:
 *  past this, the OLDEST waiting message is dropped (state sync wants the newest) and the drop
 *  is a named refusal. */
const QUEUE_CAP = 100;

const statusAll = (shared: SharedStream, value: string): void => {
  for (const sub of shared.subs) {
    /** Compare-before-write — the counts lesson: an identical write re-runs every reader. */
    if (sub.status && sub.lastStatus !== value) {
      sub.lastStatus = value;
      sub.context.set(sub.status, value);
    }
  }
};

/**
 * One message, one subscriber — and THE PAYLOAD DECIDES, fetch's law at push cadence: JSON
 * object is a state patch (`_vd` reserved, reflections update themselves), anything unparseable
 * is MARKUP swapped into `into` (same-origin ONLY, absolute — a long-lived channel is a richer
 * injection target than a one-shot fetch, not a lesser one), and a JSON scalar or array is a
 * refusal. A pushed swap rides the flip door: discrete by definition, and never establishment —
 * the page rendered its own establishment before the stream opened.
 */
const deliver = (shared: SharedStream, sub: StreamSub, data: string): void => {
  let parsed: unknown;
  let isJson = true;
  try {
    parsed = JSON.parse(data);
  } catch {
    isJson = false;
  }
  if (isJson && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [key, patch] of Object.entries(parsed as Record<string, unknown>)) {
      if (key.startsWith('_vd')) continue;
      sub.context.set(key, patch);
    }
    return;
  }
  if (isJson) {
    sub.context.reject('stream-json-not-object');
    return;
  }
  if (!shared.sameOrigin) {
    sub.context.reject('stream-foreign-markup');
    return;
  }
  const into = swapTarget(sub.element, sub.into);
  if (!into) {
    sub.context.reject('stream-target-missing', [String(sub.into)]);
    return;
  }
  const current = claimCommit(into);
  const changes: readonly ListChange[] = [{ item: into, kind: 'swap' }];
  commitFlip({
    doc: sub.element.ownerDocument!,
    animate: sub.animate,
    first: false,
    discrete: true,
    changes,
  }, () => {
    if (current()) into.innerHTML = data;
  });
};

/** SSE: every event name any subscriber wants, attached once; dispatch fans to the listeners.
 *  Names NO subscriber wants any more are detached — a reconfigured `event` list must not leave
 *  ghosts accumulating on a long-lived shared source. */
const ensureListening = (shared: SharedStream, names: readonly string[]): void => {
  const source = shared.source;
  if (!source || shared.transport !== 'sse') return;
  for (const name of names) {
    if (shared.listening.has(name)) continue;
    const dispatch = (event: Event): void => {
      for (const sub of shared.subs) {
        if (sub.events.includes(name)) deliver(shared, sub, String((event as MessageEvent).data));
      }
    };
    shared.listening.set(name, dispatch);
    source.addEventListener(name, dispatch);
  }
  const wanted = new Set<string>();
  for (const sub of shared.subs) for (const name of sub.events) wanted.add(name);
  for (const [name, dispatch] of shared.listening) {
    if (!wanted.has(name)) {
      shared.listening.delete(name);
      source.removeEventListener(name, dispatch);
    }
  }
};

const connectStream = (href: string, shared: SharedStream): void => {
  if (shared.transport === 'sse') {
    /** EventSource reconnects ITSELF — the whole reason SSE is the http transport here. */
    const source = new EventSource(href);
    shared.source = source;
    source.onopen = () => statusAll(shared, 'open');
    source.onerror = () =>
      statusAll(shared, source.readyState === 2 /* CLOSED */ ? 'error' : 'connecting');
    const wanted = new Set<string>();
    for (const sub of shared.subs) for (const name of sub.events) wanted.add(name);
    ensureListening(shared, [...wanted]);
    return;
  }
  const socket = new WebSocket(href);
  shared.source = socket;
  socket.onopen = () => {
    shared.retry = 0;
    statusAll(shared, 'open');
    for (const waiting of shared.queue.splice(0)) socket.send(waiting);
  };
  socket.onmessage = (event) => {
    for (const sub of shared.subs) deliver(shared, sub, String(event.data));
  };
  socket.onerror = () => statusAll(shared, 'error');
  /**
   * The socket has no native reconnect, so this pack owns one: capped exponential backoff with
   * jitter, reset on open, abandoned when the last subscriber leaves. The platform's SSE story
   * is why this is the ONLY reconnect loop in the framework.
   */
  socket.onclose = () => {
    shared.source = null;
    if (shared.subs.size === 0) return;
    statusAll(shared, 'connecting');
    const delay = Math.min(30_000, 500 * 2 ** shared.retry) * (1 + Math.random() * 0.3);
    shared.retry++;
    shared.timer = setTimeout(() => connectStream(href, shared), delay);
  };
};

const subscribeStream = (
  target: { href: string; sameOrigin: boolean; transport: 'sse' | 'ws' },
  sub: StreamSub
): (() => void) => {
  let shared = streams.get(target.href);
  if (!shared) {
    shared = { transport: target.transport, sameOrigin: target.sameOrigin, subs: new Set(),
      source: null, queue: [], retry: 0, timer: null, listening: new Map() };
    streams.set(target.href, shared);
  }
  shared.subs.add(sub);
  if (sub.status) statusAll(shared, shared.source ? 'open' : 'connecting');
  if (!shared.source) connectStream(target.href, shared);
  else ensureListening(shared, sub.events);
  return () => {
    shared.subs.delete(sub);
    if (shared.subs.size > 0) {
      /** The leaver's event names may now be wanted by no one — prune, or a long-lived shared
       *  source accumulates ghosts. */
      ensureListening(shared, []);
      return;
    }
    if (shared.timer) clearTimeout(shared.timer);
    shared.source?.close();
    shared.source = null;
    streams.delete(target.href);
  };
};

const streamDirective: Directive = {
  name: 'stream',
  value: 'object',
  priority: 70,
  docs: {
    summary: 'Holds a live connection; each pushed message patches state or swaps markup in.',
    example: "data-vd-stream=\"{ url: '/live', status: 'link' }\"",
  },
  /** No `ssr` declaration, deliberately: a server does not hold connections. The page's own
   *  server render IS the establishment; the stream takes over from there. */
  setup() {
    /** Per-instance state as setup closure — the connection must NOT live in apply's returned
     *  cleanup, because the engine runs that before EVERY re-apply and the send pump re-applies
     *  on each outbox write. `teardown` runs once, at deactivation. */
    let current: { href: string; sub: StreamSub; unsubscribe: () => void } | null = null;
    let lastSent: string | undefined;
    return {
      teardown: () => {
        current?.unsubscribe();
        current = null;
      },
      apply: (element: Element, value: unknown, context: Ctx) => {
        if (!isObject(value as never)) {
          context.reject('stream-not-object');
          return;
        }
        const cfg = value as Record<string, unknown>;
        const read = (key: string): unknown => context.eval(cfg[key]);
        const target = resolveStreamUrl(read('url'));
        if (!target) {
          current?.unsubscribe();
          current = null;
          context.reject('stream-url-refused', [String(read('url'))]);
          return;
        }
        if (typeof (target.transport === 'ws' ? globalThis.WebSocket : globalThis.EventSource) !== 'function') {
          context.reject('stream-unavailable', [target.transport === 'ws' ? 'WebSocket' : 'EventSource']);
          return;
        }
        const status = typeof read('status') === 'string' ? (read('status') as string) : null;
        const events = typeof read('event') === 'string'
          ? String(read('event')).split(/[\s,]+/).filter(Boolean)
          : ['message'];
        const sendKey = typeof read('send') === 'string' ? (read('send') as string) : null;
        if (sendKey && target.transport === 'sse') context.reject('stream-sse-send');
        /** READING the outbox here is what subscribes the pump: a write re-runs this apply.
         *  Plain data by the engine's writes-hold-data rule (assignments deep-evaluate since
         *  2026-09-11), so the wire form is one stringify away. */
        const outgoing = sendKey && target.transport === 'ws' ? context.get(sendKey) : undefined;

        if (!current || current.href !== target.href) {
          current?.unsubscribe();
          const sub: StreamSub = { element, context, into: read('into'), status, animate: read('animate') === true, events };
          current = { href: target.href, sub, unsubscribe: subscribeStream(target, sub) };
          /** A pre-seeded outbox is ESTABLISHMENT: recorded, never sent — the page settling
           *  into its markup answers no one, the same law every other surface follows. */
          lastSent = outgoing === undefined ? undefined : JSON.stringify(outgoing);
          return;
        }
        /** Same connection: reconfigure the subscriber in place, then pump the outbox. */
        current.sub.into = read('into');
        current.sub.status = status;
        current.sub.animate = read('animate') === true;
        current.sub.events = events;
        const shared = streams.get(current.href);
        if (shared) ensureListening(shared, events);
        if (outgoing !== undefined) {
          const wired = JSON.stringify(outgoing);
          if (wired !== lastSent) {
            lastSent = wired;
            const socket = shared?.source as WebSocket | null;
            if (socket && socket.readyState === 1 /* OPEN */) socket.send(wired);
            else if (shared) {
              if (shared.queue.length >= QUEUE_CAP) {
                shared.queue.shift();
                context.reject('stream-queue-full', [String(QUEUE_CAP)]);
              }
              shared.queue.push(wired);
            }
          }
        }
      },
    };
  },
};

/**
 * `wireDirectives([remote])` uses same-origin defaults; `wireDirectives([remote({ allowedOrigins,
 * headers })])` configures. The dual dispatches on the engine's sigiled seams mark, implemented
 * locally so this pack imports nothing from the engine.
 */
const connect = (options?: RemoteOptions): EngineConnector => (seams) => {
  /** An option this pack does not have is a mistake, and silence about it is the bug (the
   *  router's rule, applied here by the enforcement-homes enumeration — this dual and sensors'
   *  were the two silent ones; motion already warned). */
  if (__DEV__ && options) {
    for (const key of Object.keys(options))
      if (key !== 'allowedOrigins' && key !== 'headers')
        console.warn(`[vera] remote: \`${key}\` is not a remote option, so it was ignored. The options are allowedOrigins, headers.`);
  }
  allowedOrigins = [];
  for (const entry of options?.allowedOrigins ?? []) {
    try {
      allowedOrigins.push(new URL(entry).origin);
    } catch {
      seams.reject(null, 'remote', 'origin-not-url', [JSON.stringify(entry)]);
    }
  }
  headers = { ...(options?.headers ?? {}) };
  seams.directive(fetchDirective);
  seams.directive(streamDirective);
};

export const remote = dual<RemoteOptions>(connect);
