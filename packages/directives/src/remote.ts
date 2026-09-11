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
import type { Directive, Ctx, EngineConnector } from './types.js';


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
            if (type.includes('json')) {
              /** A STATE PATCH. Every reflection already reads these keys, so nothing here
               *  renders anything — the page updates itself. */
              const data = await response.json();
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
              const markup = await response.text();
              const current = claimCommit(into);
              commitFlip({
                doc: element.ownerDocument!,
                animate: read('animate') === true,
                first: trigger === 'load',
                discrete: true,
                changes: [{ item: into, kind: 'swap' }],
              }, () => {
                if (!current()) return;
                if (place === 'replace') into.innerHTML = markup;
                else into.insertAdjacentHTML(place === 'append' ? 'beforeend' : 'afterbegin', markup);
              });
            }
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

        /** `on: 'load'` means AT ACTIVATION — the same word, and the same meaning, `on-load` has. */
        if (trigger === 'load') {
          void run();
          return;
        }
        element.addEventListener(trigger, run);
        return () => {
          inflight?.abort();
          element.removeEventListener(trigger, run);
        };
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
};

export const remote = dual<RemoteOptions>(connect);
